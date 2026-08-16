const crypto = require('crypto');

// Verhoeff algorithm tables - this is the actual checksum scheme UIDAI uses
// to generate the 12th (last) digit of every real Aadhaar number.
const d = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
    [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
    [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
    [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
    [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
    [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
    [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
    [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]
];

const p = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
    [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
    [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
    [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
    [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]
];

/**
 * Validates that a string is a well-formed Aadhaar number:
 * - exactly 12 digits
 * - does not start with 0 or 1 (UIDAI never issues these)
 * - passes the Verhoeff checksum
 *
 * IMPORTANT: This confirms the number is a *structurally valid* Aadhaar
 * number. It does NOT confirm the number belongs to the person submitting
 * it, or that it is registered with UIDAI. Real identity verification
 * requires UIDAI's e-KYC/Authentication API, which is only available to
 * licensed AUA/KUA entities after a formal registration process.
 */
function isValidAadhaarFormat(number) {
    if (typeof number !== 'string') return false;
    const cleaned = number.replace(/\s/g, '');
    if (!/^[2-9][0-9]{11}$/.test(cleaned)) return false;

    const digits = cleaned.split('').reverse().map(Number);
    let c = 0;
    for (let i = 0; i < digits.length; i++) {
        c = d[c][p[i % 8][digits[i]]];
    }
    return c === 0;
}

/** One-way hash used only to detect duplicate signups with the same Aadhaar number. */
function hashAadhaar(number) {
    const cleaned = number.replace(/\s/g, '');
    return crypto.createHash('sha256').update(cleaned + process.env.JWT_SECRET).digest('hex');
}

function lastFour(number) {
    const cleaned = number.replace(/\s/g, '');
    return cleaned.slice(-4);
}

module.exports = { isValidAadhaarFormat, hashAadhaar, lastFour };