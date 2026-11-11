// Usage: npm run hash-password -w server
// Asks for the owner password (twice, without showing it) and prints the two lines for
// server/.env: the password's hash and a new random session secret.

import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import { hashPassword } from '../auth.js';

/** Asks a question without echoing what's typed. */
const askHidden = (question: string) =>
    new Promise<string>((resolve) => {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        let muted = false;
        // readline has no hidden-input option; drop the echo of the typed characters instead
        const writer = rl as unknown as { _writeToOutput: (s: string) => void };
        writer._writeToOutput = (s: string) => {
            if (!muted) process.stdout.write(s);
        };
        rl.question(question, (answer) => {
            rl.close();
            process.stdout.write('\n');
            resolve(answer);
        });
        muted = true;
    });

// It reads the password from the keyboard, which needs a real terminal
if (!process.stdin.isTTY) {
    console.error('Run this in a terminal: npm run hash-password -w server');
    process.exit(1);
}

const password = await askHidden('Owner password: ');
if (password.length < 12) {
    console.error('Use at least 12 characters.');
    process.exit(1);
}
if ((await askHidden('Again: ')) !== password) {
    console.error("The passwords don't match.");
    process.exit(1);
}

console.log('\nPaste these into server/.env:\n');
console.log(`OWNER_PASSWORD_HASH=${await hashPassword(password)}`);
console.log(`SESSION_SECRET=${randomBytes(32).toString('base64url')}`);
