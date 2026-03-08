/**
 * FalconForge Complete Database Backup
 * Connects directly to PostgreSQL to capture EVERYTHING:
 *   - Full table schema (columns, types, defaults, constraints)
 *   - Foreign keys
 *   - Indexes
 *   - RLS policies
 *   - Functions & stored procedures
 *   - Triggers
 *   - Table data (all rows)
 *
 * Usage:
 *   set SUPABASE_DB_PASSWORD=your_password
 *   node backup-full.mjs
 *
 * Find your DB password: Supabase Dashboard → Settings → Database → Database password
 */

import pg from 'pg';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const { Client } = pg;

// Connection config
// Uses Supabase session pooler (IPv4) instead of direct host (IPv6 only)
const SUPABASE_PROJECT_REF = 'cvnonrjzshaawzxcjwmn';
const DB_HOST = 'aws-0-us-west-2.pooler.supabase.com';
const DB_PORT = 5432;  // Session mode (not transaction mode which is 6543)
const DB_NAME = 'postgres';
const DB_USER = `postgres.${SUPABASE_PROJECT_REF}`;
const DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;

if (!DB_PASSWORD) {
    console.error('ERROR: Set the SUPABASE_DB_PASSWORD environment variable first.');
    console.error('');
    console.error('  PowerShell:  $env:SUPABASE_DB_PASSWORD="your_password"');
    console.error('  Then:        node backup-full.mjs');
    console.error('');
    console.error('Find your password: Supabase Dashboard → Settings → Database → Database password');
    process.exit(1);
}

// Create backup directory
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const backupDir = join('.', `backup-full-${timestamp}`);
mkdirSync(backupDir, { recursive: true });

async function main() {
    console.log('Connecting to database...');

    const client = new Client({
        host: DB_HOST,
        port: DB_PORT,
        database: DB_NAME,
        user: DB_USER,
        password: DB_PASSWORD,
        ssl: { rejectUnauthorized: false },
    });

    try {
        await client.connect();
        console.log('Connected!\n');

        // ========================================
        // 1. TABLES & COLUMNS
        // ========================================
        console.log('1/7  Exporting table schemas...');
        const columnsResult = await client.query(`
            SELECT table_name, column_name, data_type, udt_name,
                   is_nullable, column_default, ordinal_position,
                   character_maximum_length, numeric_precision
            FROM information_schema.columns
            WHERE table_schema = 'public'
            ORDER BY table_name, ordinal_position;
        `);
        writeJSON('01_table_columns.json', columnsResult.rows);
        const tableNames = [...new Set(columnsResult.rows.map(r => r.table_name))];
        console.log(`   Found ${tableNames.length} tables: ${tableNames.join(', ')}`);

        // ========================================
        // 2. CONSTRAINTS (PK, FK, UNIQUE, CHECK)
        // ========================================
        console.log('2/7  Exporting constraints...');

        // Primary keys & unique constraints
        const pkResult = await client.query(`
            SELECT tc.table_name, tc.constraint_name, tc.constraint_type,
                   kcu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu 
                ON tc.constraint_name = kcu.constraint_name
                AND tc.table_schema = kcu.table_schema
            WHERE tc.table_schema = 'public'
            ORDER BY tc.table_name, tc.constraint_type, tc.constraint_name;
        `);
        writeJSON('02_pk_unique_constraints.json', pkResult.rows);

        // Foreign keys
        const fkResult = await client.query(`
            SELECT
                tc.table_name,
                tc.constraint_name,
                kcu.column_name,
                ccu.table_name AS foreign_table,
                ccu.column_name AS foreign_column,
                rc.update_rule,
                rc.delete_rule
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
                ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage ccu
                ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
            JOIN information_schema.referential_constraints rc
                ON tc.constraint_name = rc.constraint_name AND tc.table_schema = rc.constraint_schema
            WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
            ORDER BY tc.table_name, tc.constraint_name;
        `);
        writeJSON('02_foreign_keys.json', fkResult.rows);
        console.log(`   Found ${pkResult.rows.length} PK/unique constraints, ${fkResult.rows.length} foreign keys`);

        // Check constraints
        const checkResult = await client.query(`
            SELECT conname AS constraint_name, 
                   conrelid::regclass AS table_name,
                   pg_get_constraintdef(oid) AS definition
            FROM pg_constraint
            WHERE contype = 'c' 
              AND connamespace = 'public'::regnamespace
            ORDER BY conrelid::regclass::text, conname;
        `);
        writeJSON('02_check_constraints.json', checkResult.rows);

        // ========================================
        // 3. INDEXES
        // ========================================
        console.log('3/7  Exporting indexes...');
        const indexResult = await client.query(`
            SELECT schemaname, tablename, indexname, indexdef
            FROM pg_indexes
            WHERE schemaname = 'public'
            ORDER BY tablename, indexname;
        `);
        writeJSON('03_indexes.json', indexResult.rows);
        console.log(`   Found ${indexResult.rows.length} indexes`);

        // ========================================
        // 4. RLS POLICIES
        // ========================================
        console.log('4/7  Exporting RLS policies...');
        const rlsResult = await client.query(`
            SELECT schemaname, tablename, policyname, permissive, roles::text,
                   cmd, qual, with_check
            FROM pg_policies
            WHERE schemaname = 'public'
            ORDER BY tablename, policyname;
        `);
        writeJSON('04_rls_policies.json', rlsResult.rows);

        // RLS enabled status
        const rlsStatusResult = await client.query(`
            SELECT relname AS tablename, relrowsecurity AS rls_enabled
            FROM pg_class
            WHERE relnamespace = 'public'::regnamespace
              AND relkind = 'r'
            ORDER BY relname;
        `);
        writeJSON('04_rls_status.json', rlsStatusResult.rows);
        console.log(`   Found ${rlsResult.rows.length} policies across ${rlsStatusResult.rows.filter(r => r.rls_enabled).length} RLS-enabled tables`);

        // ========================================
        // 5. FUNCTIONS
        // ========================================
        console.log('5/7  Exporting functions...');
        const funcResult = await client.query(`
            SELECT p.proname AS function_name,
                   pg_get_functiondef(p.oid) AS full_definition,
                   p.prosecdef AS security_definer,
                   p.provolatile AS volatility,
                   l.lanname AS language,
                   pg_get_function_arguments(p.oid) AS arguments,
                   pg_get_function_result(p.oid) AS return_type
            FROM pg_proc p
            JOIN pg_language l ON p.prolang = l.oid
            WHERE p.pronamespace = 'public'::regnamespace
            ORDER BY p.proname;
        `);
        writeJSON('05_functions.json', funcResult.rows);
        console.log(`   Found ${funcResult.rows.length} functions: ${funcResult.rows.map(f => f.function_name).join(', ')}`);

        // ========================================
        // 6. TRIGGERS
        // ========================================
        console.log('6/7  Exporting triggers...');
        const triggerResult = await client.query(`
            SELECT trigger_name, event_manipulation, event_object_table,
                   action_statement, action_timing, action_orientation
            FROM information_schema.triggers
            WHERE trigger_schema = 'public'
            ORDER BY event_object_table, trigger_name;
        `);

        // Also get the auth.users trigger
        const authTriggerResult = await client.query(`
            SELECT tgname AS trigger_name,
                   tgrelid::regclass AS table_name,
                   pg_get_triggerdef(oid) AS definition
            FROM pg_trigger
            WHERE tgrelid = 'auth.users'::regclass
              AND NOT tgisinternal
            ORDER BY tgname;
        `);
        writeJSON('06_triggers.json', triggerResult.rows);
        writeJSON('06_auth_triggers.json', authTriggerResult.rows);
        console.log(`   Found ${triggerResult.rows.length} public triggers, ${authTriggerResult.rows.length} auth triggers`);

        // ========================================
        // 7. TABLE DATA
        // ========================================
        console.log('7/7  Exporting table data...');
        for (const tableName of tableNames) {
            try {
                const dataResult = await client.query(`SELECT * FROM public."${tableName}"`);
                writeJSON(`data_${tableName}.json`, dataResult.rows);
                console.log(`   ✅ ${tableName}: ${dataResult.rows.length} rows`);
            } catch (err) {
                console.log(`   ❌ ${tableName}: ${err.message}`);
            }
        }

        // ========================================
        // 8. GENERATE RESTORE SQL
        // ========================================
        console.log('\nGenerating restore SQL...');
        await generateRestoreSQL(client, backupDir);

        // ========================================
        // SUMMARY
        // ========================================
        console.log(`\n${'='.repeat(50)}`);
        console.log(`Backup complete!`);
        console.log(`Directory: ${backupDir}`);
        console.log(`${'='.repeat(50)}`);
        console.log(`\nContents:`);
        console.log(`  01_table_columns.json     - Column definitions`);
        console.log(`  02_*.json                 - Constraints (PK, FK, unique, check)`);
        console.log(`  03_indexes.json           - All indexes`);
        console.log(`  04_rls_policies.json      - Row Level Security policies`);
        console.log(`  04_rls_status.json        - RLS enabled/disabled per table`);
        console.log(`  05_functions.json         - All stored functions (with source)`);
        console.log(`  06_triggers.json          - All triggers`);
        console.log(`  06_auth_triggers.json     - Auth schema triggers`);
        console.log(`  07_restore.sql            - Full restore script (DDL + RLS + functions)`);
        console.log(`  data_*.json               - Table data`);

    } catch (err) {
        console.error('Database error:', err.message);
        if (err.message.includes('password authentication failed')) {
            console.error('\nDouble-check your password in Supabase Dashboard → Settings → Database');
        } else if (err.message.includes('ENOTFOUND') || err.message.includes('getaddrinfo')) {
            console.error('\nCould not resolve database hostname. Check your internet connection.');
        }
        process.exit(1);
    } finally {
        await client.end();
    }
}

/**
 * Generate a complete SQL restore script from the live database
 */
async function generateRestoreSQL(client, dir) {
    const lines = [];
    lines.push('-- ==========================================');
    lines.push('-- FalconForge Complete Database Restore');
    lines.push(`-- Generated: ${new Date().toISOString()}`);
    lines.push('-- ==========================================');
    lines.push('');

    // 1. Functions first (needed by RLS policies)
    lines.push('-- ==========================================');
    lines.push('-- FUNCTIONS (must be created before RLS)');
    lines.push('-- ==========================================');
    const funcs = await client.query(`
        SELECT pg_get_functiondef(p.oid) AS definition
        FROM pg_proc p
        WHERE p.pronamespace = 'public'::regnamespace
        ORDER BY p.proname;
    `);
    for (const f of funcs.rows) {
        lines.push('');
        lines.push(f.definition + ';');
    }

    // 2. Tables (use pg_dump-style DDL)
    lines.push('');
    lines.push('-- ==========================================');
    lines.push('-- TABLES');
    lines.push('-- ==========================================');

    const tables = await client.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name;
    `);

    for (const { table_name } of tables.rows) {
        // Get column definitions
        const cols = await client.query(`
            SELECT column_name, udt_name, data_type, is_nullable, column_default,
                   character_maximum_length, numeric_precision, numeric_scale
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = $1
            ORDER BY ordinal_position;
        `, [table_name]);

        lines.push('');
        lines.push(`CREATE TABLE IF NOT EXISTS ${table_name} (`);

        const colDefs = [];
        for (const col of cols.rows) {
            let type = mapDataType(col);
            let def = `    ${col.column_name} ${type}`;
            if (col.column_default) def += ` DEFAULT ${col.column_default}`;
            if (col.is_nullable === 'NO') def += ' NOT NULL';
            colDefs.push(def);
        }

        // Add primary key
        const pk = await client.query(`
            SELECT kcu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
            WHERE tc.table_schema = 'public' AND tc.table_name = $1 AND tc.constraint_type = 'PRIMARY KEY'
            ORDER BY kcu.ordinal_position;
        `, [table_name]);

        if (pk.rows.length > 0) {
            colDefs.push(`    PRIMARY KEY (${pk.rows.map(r => r.column_name).join(', ')})`);
        }

        // Add unique constraints
        const uniques = await client.query(`
            SELECT conname, pg_get_constraintdef(oid) AS definition
            FROM pg_constraint
            WHERE contype = 'u' AND conrelid = $1::regclass;
        `, [`public.${table_name}`]);

        for (const u of uniques.rows) {
            colDefs.push(`    CONSTRAINT ${u.conname} ${u.definition}`);
        }

        // Add check constraints
        const checks = await client.query(`
            SELECT conname, pg_get_constraintdef(oid) AS definition
            FROM pg_constraint
            WHERE contype = 'c' AND conrelid = $1::regclass;
        `, [`public.${table_name}`]);

        for (const c of checks.rows) {
            colDefs.push(`    CONSTRAINT ${c.conname} ${c.definition}`);
        }

        lines.push(colDefs.join(',\n'));
        lines.push(');');

        // Foreign keys (after table creation to handle circular deps)
        const fks = await client.query(`
            SELECT conname, pg_get_constraintdef(oid) AS definition
            FROM pg_constraint
            WHERE contype = 'f' AND conrelid = $1::regclass;
        `, [`public.${table_name}`]);

        for (const fk of fks.rows) {
            lines.push(`ALTER TABLE ${table_name} ADD CONSTRAINT ${fk.conname} ${fk.definition};`);
        }
    }

    // 3. Indexes  
    lines.push('');
    lines.push('-- ==========================================');
    lines.push('-- INDEXES');
    lines.push('-- ==========================================');
    const indexes = await client.query(`
        SELECT indexdef FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname NOT LIKE '%_pkey'
          AND indexname NOT LIKE '%_unique%'
          AND indexname NOT LIKE '%_key'
        ORDER BY tablename, indexname;
    `);
    for (const idx of indexes.rows) {
        lines.push(idx.indexdef.replace('CREATE INDEX', 'CREATE INDEX IF NOT EXISTS') + ';');
    }

    // 4. RLS
    lines.push('');
    lines.push('-- ==========================================');
    lines.push('-- ROW LEVEL SECURITY');
    lines.push('-- ==========================================');

    const rlsStatus = await client.query(`
        SELECT relname FROM pg_class
        WHERE relnamespace = 'public'::regnamespace AND relrowsecurity = true AND relkind = 'r';
    `);
    for (const t of rlsStatus.rows) {
        lines.push(`ALTER TABLE ${t.relname} ENABLE ROW LEVEL SECURITY;`);
    }

    const policies = await client.query(`
        SELECT tablename, policyname, permissive, roles::text, cmd, qual, with_check
        FROM pg_policies WHERE schemaname = 'public'
        ORDER BY tablename, policyname;
    `);
    for (const p of policies.rows) {
        lines.push('');
        let sql = `CREATE POLICY ${p.policyname} ON ${p.tablename}`;
        sql += `\n    FOR ${p.cmd}`;
        if (p.qual) sql += `\n    USING (${p.qual})`;
        if (p.with_check) sql += `\n    WITH CHECK (${p.with_check})`;
        sql += ';';
        lines.push(sql);
    }

    // 5. Triggers
    lines.push('');
    lines.push('-- ==========================================');
    lines.push('-- TRIGGERS');
    lines.push('-- ==========================================');
    const triggers = await client.query(`
        SELECT trigger_name, event_manipulation, event_object_table,
               action_statement, action_timing
        FROM information_schema.triggers
        WHERE trigger_schema = 'public'
        ORDER BY event_object_table, trigger_name;
    `);
    // Deduplicate (triggers show up per event)
    const seenTriggers = new Set();
    for (const t of triggers.rows) {
        const key = `${t.trigger_name}_${t.event_object_table}`;
        if (seenTriggers.has(key)) continue;
        seenTriggers.add(key);
        lines.push(`DROP TRIGGER IF EXISTS ${t.trigger_name} ON ${t.event_object_table};`);
        lines.push(`CREATE TRIGGER ${t.trigger_name}`);
        lines.push(`    ${t.action_timing} ${t.event_manipulation} ON ${t.event_object_table}`);
        lines.push(`    FOR EACH ROW`);
        lines.push(`    ${t.action_statement};`);
    }

    // Auth trigger
    const authTriggers = await client.query(`
        SELECT pg_get_triggerdef(oid) AS definition, tgname
        FROM pg_trigger
        WHERE tgrelid = 'auth.users'::regclass AND NOT tgisinternal;
    `);
    if (authTriggers.rows.length > 0) {
        lines.push('');
        lines.push('-- Auth schema triggers');
        for (const at of authTriggers.rows) {
            lines.push(`DROP TRIGGER IF EXISTS ${at.tgname} ON auth.users;`);
            lines.push(at.definition + ';');
        }
    }

    const restorePath = join(dir, '07_restore.sql');
    writeFileSync(restorePath, lines.join('\n'));
    console.log('   Generated 07_restore.sql');
}

function mapDataType(col) {
    const { udt_name, data_type, character_maximum_length } = col;
    // Handle array types
    if (data_type === 'ARRAY') return udt_name.replace(/^_/, '') + '[]';
    // Handle common types
    switch (udt_name) {
        case 'uuid': return 'uuid';
        case 'text': return 'text';
        case 'int4': return 'integer';
        case 'int8': return 'bigint';
        case 'bool': return 'boolean';
        case 'timestamptz': return 'timestamptz';
        case 'timestamp': return 'timestamp';
        case 'jsonb': return 'jsonb';
        case 'json': return 'json';
        case 'varchar': return character_maximum_length ? `varchar(${character_maximum_length})` : 'varchar';
        default: return udt_name;
    }
}

function writeJSON(filename, data) {
    writeFileSync(join(backupDir, filename), JSON.stringify(data, null, 2));
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
