/**
 * FalconForge Database Backup Script
 * Exports all Supabase table data to JSON files in a backup/ directory.
 * Also saves the current schema info.
 * 
 * Usage: node backup-database.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

// Read from .env.local
import { readFileSync } from 'fs';
const envContent = readFileSync('.env.local', 'utf-8');
const envVars = {};
envContent.split('\n').forEach(line => {
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length) {
        envVars[key.trim()] = valueParts.join('=').trim();
    }
});

const supabaseUrl = envVars.VITE_SUPABASE_URL;
const supabaseKey = envVars.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env.local');
    process.exit(1);
}

// IMPORTANT: You need to sign in to access RLS-protected data.
// Replace these with a coach account's credentials to get full access.
const EMAIL = 'jkfussell@gmail.com';
const PASSWORD = 'scooby';

const supabase = createClient(supabaseUrl, supabaseKey);

// All tables to back up
const TABLES = [
    'users',
    'teams',
    'team_members',
    'seasons',
    'sub_teams',
    'sub_team_members',
    'tasks',
    'scouting_reports',
    'match_plans',
    'checklists',
    'invites',
    'user_attestations',
];

async function main() {
    // Create backup directory with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupDir = join('.', `backup-${timestamp}`);

    if (!existsSync(backupDir)) {
        mkdirSync(backupDir, { recursive: true });
    }

    console.log(`\nBackup directory: ${backupDir}\n`);

    // Sign in to get access through RLS
    console.log('Signing in...');
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: EMAIL,
        password: PASSWORD,
    });

    if (authError) {
        console.error('Auth error:', authError.message);
        console.error('Update EMAIL and PASSWORD in this script with valid coach credentials.');
        process.exit(1);
    }
    console.log(`Signed in as: ${authData.user.email}\n`);

    // Export each table
    const summary = {};

    for (const table of TABLES) {
        process.stdout.write(`Exporting ${table}...`);

        try {
            // Fetch all rows (paginate if needed)
            let allRows = [];
            let offset = 0;
            const pageSize = 1000;

            while (true) {
                const { data, error } = await supabase
                    .from(table)
                    .select('*')
                    .range(offset, offset + pageSize - 1);

                if (error) {
                    console.log(` ERROR: ${error.message}`);
                    summary[table] = { status: 'error', error: error.message };
                    break;
                }

                if (!data || data.length === 0) {
                    if (offset === 0) {
                        // Table is empty or no access
                        summary[table] = { status: 'ok', rows: 0 };
                    }
                    break;
                }

                allRows = allRows.concat(data);

                if (data.length < pageSize) break; // Last page
                offset += pageSize;
            }

            if (allRows.length > 0 || (summary[table]?.status !== 'error')) {
                const filePath = join(backupDir, `${table}.json`);
                writeFileSync(filePath, JSON.stringify(allRows, null, 2));
                console.log(` ${allRows.length} rows`);
                summary[table] = { status: 'ok', rows: allRows.length };
            }
        } catch (err) {
            console.log(` EXCEPTION: ${err.message}`);
            summary[table] = { status: 'error', error: err.message };
        }
    }

    // Save summary
    const summaryPath = join(backupDir, '_backup_summary.json');
    writeFileSync(summaryPath, JSON.stringify({
        timestamp: new Date().toISOString(),
        supabaseUrl,
        user: authData.user.email,
        tables: summary,
    }, null, 2));

    // Print summary
    console.log('\n--- Backup Summary ---');
    console.log(`Timestamp: ${new Date().toISOString()}`);
    for (const [table, info] of Object.entries(summary)) {
        const icon = info.status === 'ok' ? '✅' : '❌';
        const detail = info.status === 'ok' ? `${info.rows} rows` : info.error;
        console.log(`  ${icon} ${table}: ${detail}`);
    }
    console.log(`\nAll files saved to: ${backupDir}`);
    console.log('Done!\n');

    // Sign out
    await supabase.auth.signOut();
}

main().catch(console.error);
