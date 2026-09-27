import argon2 from "argon2";

export const hash = async (password: string) => {
    return argon2.hash(password, { type: argon2.argon2id });
}

export const compare = async (password: string, hash: string) => {
    try {
        return await argon2.verify(hash, password);
    } catch {
        return false;
    }
}
