"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.encodeBase62 = encodeBase62;
const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const BASE = ALPHABET.length;
/**
 * Encodes a non-negative integer using base62.
 *
 * The database sequence provides a unique numeric id. Base62 is only a
 * compact, deterministic representation of that id, so two ids cannot
 * produce the same short code and no random collision-check loop is needed.
 */
function encodeBase62(num) {
    if (!Number.isSafeInteger(num) || num < 0) {
        throw new Error("Base62 encoding requires a non-negative safe integer");
    }
    if (num === 0) {
        return ALPHABET[0];
    }
    let value = num;
    let encoded = "";
    while (value > 0) {
        encoded = ALPHABET[value % BASE] + encoded;
        value = Math.floor(value / BASE);
    }
    return encoded;
}
