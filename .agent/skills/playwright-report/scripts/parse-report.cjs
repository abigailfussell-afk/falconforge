#!/usr/bin/env node

/**
 * Playwright Report Parser
 * 
 * Reads playwright-report/results.json and produces a structured
 * analysis markdown file at playwright-report/analysis.md.
 * 
 * Usage:
 *   node .agent/skills/playwright-report/scripts/parse-report.js
 *   node .agent/skills/playwright-report/scripts/parse-report.js --json
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const RESULTS_PATH = path.join(PROJECT_ROOT, 'playwright-report', 'results.json');
const OUTPUT_PATH = path.join(PROJECT_ROOT, 'playwright-report', 'analysis.md');
const OUTPUT_JSON_PATH = path.join(PROJECT_ROOT, 'playwright-report', 'analysis.json');

/**
 * Strip ANSI escape codes from a string.
 */
function stripAnsi(str) {
    if (!str) return str;
    // eslint-disable-next-line no-control-regex
    return str.replace(/\x1b\[[0-9;]*m/g, '');
}

function main() {
    const jsonMode = process.argv.includes('--json');

    if (!fs.existsSync(RESULTS_PATH)) {
        console.error(`ERROR: ${RESULTS_PATH} not found.`);
        console.error('Run "npm run test:e2e" first to generate the report.');
        process.exit(1);
    }

    const raw = fs.readFileSync(RESULTS_PATH, 'utf-8');
    const report = JSON.parse(raw);

    const analysis = analyzeReport(report);

    if (jsonMode) {
        fs.writeFileSync(OUTPUT_JSON_PATH, JSON.stringify(analysis, null, 2));
        console.log(`JSON analysis written to: ${OUTPUT_JSON_PATH}`);
    }

    const markdown = renderMarkdown(analysis);
    fs.writeFileSync(OUTPUT_PATH, markdown);
    console.log(`Analysis written to: ${OUTPUT_PATH}`);
    console.log(`\nSummary: ${analysis.summary.total} tests | ${analysis.summary.passed} passed | ${analysis.summary.failed} failed | ${analysis.summary.skipped} skipped`);

    if (analysis.failureCategories.length > 0) {
        console.log(`\nFailure categories: ${analysis.failureCategories.length}`);
        for (const cat of analysis.failureCategories) {
            console.log(`  - ${cat.name} (${cat.tests.length} tests)`);
        }
    }
}

/**
 * Walk the Playwright JSON report tree and collect all test results.
 */
function collectTests(suite, ancestors = []) {
    const tests = [];

    if (suite.specs) {
        for (const spec of suite.specs) {
            for (const test of spec.tests || []) {
                const results = test.results || [];
                const lastResult = results[results.length - 1];
                const status = test.status || lastResult?.status || 'unknown';

                tests.push({
                    title: spec.title,
                    fullTitle: [...ancestors, spec.title].join(' › '),
                    file: spec.file || suite.file || '',
                    line: spec.line || 0,
                    column: spec.column || 0,
                    status,
                    projectName: test.projectName || test.projectId || '',
                    duration: results.reduce((sum, r) => sum + (r.duration || 0), 0),
                    retries: results.length - 1,
                    error: extractError(lastResult),
                    attachments: extractAttachments(lastResult),
                });
            }
        }
    }

    if (suite.suites) {
        const suitePath = suite.title ? [...ancestors, suite.title] : ancestors;
        for (const child of suite.suites) {
            tests.push(...collectTests(child, suitePath));
        }
    }

    return tests;
}

function extractError(result) {
    if (!result) return null;

    const error = result.error;
    if (!error) {
        // Check for errors in result.errors array
        if (result.errors && result.errors.length > 0) {
            const firstError = result.errors[0];
            return {
                message: stripAnsi(firstError.message || ''),
                stack: stripAnsi(firstError.stack || firstError.message || ''),
                snippet: stripAnsi(firstError.snippet || ''),
            };
        }
        // Check status
        if (result.status === 'failed' || result.status === 'timedOut') {
            return {
                message: result.status === 'timedOut' ? 'Test timed out' : 'Test failed (no error details)',
                stack: '',
                snippet: '',
            };
        }
        return null;
    }

    return {
        message: stripAnsi(error.message || ''),
        stack: stripAnsi(error.stack || error.message || ''),
        snippet: stripAnsi(error.snippet || ''),
    };
}

function extractAttachments(result) {
    if (!result || !result.attachments) return [];
    return result.attachments.map(a => ({
        name: a.name,
        contentType: a.contentType,
        path: a.path || null,
    }));
}

/**
 * Analyze collected tests: compute summary, group failures by error pattern.
 */
function analyzeReport(report) {
    const allTests = [];

    for (const suite of report.suites || []) {
        allTests.push(...collectTests(suite));
    }

    const passed = allTests.filter(t => t.status === 'expected' || t.status === 'passed');
    const failed = allTests.filter(t => t.status === 'unexpected' || t.status === 'failed' || t.status === 'timedOut');
    const skipped = allTests.filter(t => t.status === 'skipped');
    const flaky = allTests.filter(t => t.status === 'flaky');

    const summary = {
        total: allTests.length,
        passed: passed.length,
        failed: failed.length,
        skipped: skipped.length,
        flaky: flaky.length,
    };

    // Group failures by error pattern
    const failureCategories = categorizeFailures(failed);

    return {
        summary,
        failureCategories,
        passedTests: passed.map(t => ({ fullTitle: t.fullTitle, file: t.file, duration: t.duration })),
        flakyTests: flaky.map(t => ({ fullTitle: t.fullTitle, file: t.file, error: t.error })),
    };
}

/**
 * Group failed tests by similar error message patterns.
 */
function categorizeFailures(failedTests) {
    const categories = new Map();

    for (const test of failedTests) {
        const key = getErrorCategory(test.error);

        if (!categories.has(key)) {
            categories.set(key, {
                name: key,
                pattern: test.error?.message?.substring(0, 200) || 'Unknown error',
                tests: [],
                sampleError: test.error,
            });
        }
        categories.get(key).tests.push(test);
    }

    // Sort categories by number of affected tests (descending)
    return Array.from(categories.values()).sort((a, b) => b.tests.length - a.tests.length);
}

/**
 * Extract a category name from an error message by identifying the core pattern.
 */
function getErrorCategory(error) {
    if (!error || !error.message) return 'Unknown Error';

    const msg = error.message;

    // Timeout errors
    if (msg.includes('Timeout') || msg.includes('timeout') || msg.includes('timedOut')) {
        // Identify what timed out
        const match = msg.match(/(\w+\.\w+):\s*Timeout/);
        if (match) return `Timeout: ${match[1]}`;
        if (msg.includes('page.fill')) return 'Timeout: page.fill';
        if (msg.includes('page.click')) return 'Timeout: page.click';
        if (msg.includes('page.goto')) return 'Timeout: page.goto';
        if (msg.includes('navigation')) return 'Timeout: Navigation';
        if (msg.includes('locator.click')) return 'Timeout: locator.click';
        return 'Timeout: General';
    }

    // Assertion errors
    if (msg.includes('expect(') || msg.includes('toHaveURL') || msg.includes('toBeVisible') || msg.includes('toBe(')) {
        if (msg.includes('toHaveURL')) return 'Assertion: URL mismatch';
        if (msg.includes('toBeVisible')) return 'Assertion: Element not visible';
        if (msg.includes('toHaveText')) return 'Assertion: Text mismatch';
        return 'Assertion: General';
    }

    // Selector not found
    if (msg.includes('not found') || msg.includes('No element')) {
        return 'Element Not Found';
    }

    // Network errors
    if (msg.includes('net::') || msg.includes('ERR_')) {
        return 'Network Error';
    }

    // Truncate to first meaningful line
    const firstLine = msg.split('\n')[0].substring(0, 80);
    return firstLine || 'Unknown Error';
}

/**
 * Render the analysis as a markdown document.
 */
function renderMarkdown(analysis) {
    const lines = [];

    lines.push('# E2E Test Failure Analysis');
    lines.push('');
    lines.push(`> Generated: ${new Date().toISOString()}`);
    lines.push('');

    // Summary
    lines.push('## Summary');
    lines.push('');
    lines.push(`| Metric | Count |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Total  | ${analysis.summary.total} |`);
    lines.push(`| ✅ Passed | ${analysis.summary.passed} |`);
    lines.push(`| ❌ Failed | ${analysis.summary.failed} |`);
    lines.push(`| ⏭️ Skipped | ${analysis.summary.skipped} |`);
    lines.push(`| 🔄 Flaky | ${analysis.summary.flaky} |`);
    lines.push('');

    if (analysis.summary.failed === 0) {
        lines.push('🎉 **All tests passed!** No failures to analyze.');
        return lines.join('\n');
    }

    // Failure categories
    lines.push('## Failure Categories');
    lines.push('');

    for (let i = 0; i < analysis.failureCategories.length; i++) {
        const cat = analysis.failureCategories[i];
        lines.push(`### ${i + 1}. ${cat.name} (${cat.tests.length} test${cat.tests.length > 1 ? 's' : ''})`);
        lines.push('');
        lines.push(`**Error Pattern**: \`${cat.pattern.replace(/`/g, "'")}\``);
        lines.push('');

        // Suggest likely cause based on category
        const suggestion = getSuggestion(cat.name);
        if (suggestion) {
            lines.push(`**Likely Cause**: ${suggestion}`);
            lines.push('');
        }

        // Affected tests table
        lines.push('**Affected Tests**:');
        lines.push('');
        lines.push('| File | Test Name | Line |');
        lines.push('|------|-----------|------|');
        for (const test of cat.tests) {
            const fileName = path.basename(test.file);
            lines.push(`| ${fileName} | ${test.fullTitle} | ${test.line} |`);
        }
        lines.push('');

        // Sample error details
        if (cat.sampleError) {
            lines.push('<details>');
            lines.push('<summary>Error Details (click to expand)</summary>');
            lines.push('');
            lines.push('```');
            const errorText = cat.sampleError.stack || cat.sampleError.message || '';
            // Truncate very long stack traces
            const truncated = errorText.length > 2000
                ? errorText.substring(0, 2000) + '\n... (truncated)'
                : errorText;
            lines.push(truncated);
            lines.push('```');
            lines.push('</details>');
            lines.push('');
        }

        // How to re-run just these tests
        const uniqueFiles = [...new Set(cat.tests.map(t => t.file))];
        lines.push('**Re-run these tests**:');
        lines.push('```powershell');
        for (const file of uniqueFiles) {
            lines.push(`npx playwright test ${file}`);
        }
        lines.push('```');
        lines.push('');
        lines.push('---');
        lines.push('');
    }

    // Quick fix checklist
    lines.push('## Fix Checklist');
    lines.push('');
    for (let i = 0; i < analysis.failureCategories.length; i++) {
        const cat = analysis.failureCategories[i];
        lines.push(`- [ ] Fix: ${cat.name} (${cat.tests.length} tests)`);
    }
    lines.push('');

    return lines.join('\n');
}

/**
 * Provide a likely-cause suggestion for common failure categories.
 */
function getSuggestion(categoryName) {
    const suggestions = {
        'Timeout: page.fill': 'The target input element is not appearing on the page. Check if the app is redirecting away from the expected page (e.g., already logged in).',
        'Timeout: page.click': 'The target button/element is not becoming clickable. Check if the element exists, is visible, and is not covered by another element.',
        'Timeout: locator.click': 'The locator is not finding a matching element. Verify the selector matches the current DOM structure.',
        'Timeout: Navigation': 'Page navigation is not completing. Check if the server is running and the target URL is correct.',
        'Timeout: General': 'An operation exceeded its timeout. Consider if the app is slow to load or if a prerequisite step failed silently.',
        'Assertion: URL mismatch': 'The page URL doesn\'t match the expected pattern after an action. Check redirect logic in the app.',
        'Assertion: Element not visible': 'An expected element is not visible on the page. The component may not be rendering or may be hidden.',
        'Assertion: Text mismatch': 'The text content of an element doesn\'t match. The component may be showing different content than expected.',
        'Element Not Found': 'A selector/locator is not matching any elements. The DOM structure or test-id attributes may have changed.',
        'Network Error': 'A network request failed. Check if all required backend services are running.',
    };

    return suggestions[categoryName] || null;
}

main();
