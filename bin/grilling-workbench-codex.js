#!/usr/bin/env node
import { main } from '../adapters/codex/cli.js';

try { await main(); }
catch (error) { console.error(error.message); process.exitCode = 1; }
