export function bMGyx71TzQLfdonN(str: string): string {
    const n = 3;
    let chunks = [];
    for (let i = 0; i < str.length; i += n) {
        chunks.push(str.slice(i, i + n));
    }
    return chunks.reverse().join("");
}

export function Iry9MQXnLs(str: string): string {
    const key = "pWB9V)[*4I`nJpp?ozyB~dbr9yt!_n4u";
    let result = "";
    const matches = str.match(/.{1,2}/g);
    if (!matches) return "";
    const decoded = matches.map(x => String.fromCharCode(parseInt(x, 16))).join("");
    for (let i = 0; i < decoded.length; i++) {
        result += String.fromCharCode(
            decoded.charCodeAt(i) ^ key.charCodeAt(i % key.length),
        );
    }
    let res2 = "";
    for (let i = 0; i < result.length; i++) {
        res2 += String.fromCharCode(result.charCodeAt(i) - 3);
    }
    try {
        return Buffer.from(res2, 'base64').toString('utf-8');
    } catch (e) {
        return res2;
    }
}

export function IGLImMhWrI(str: string): string {
    const reversed = str.split("").reverse().join("");
    const rot13 = reversed.replace(/[a-zA-Z]/g, function (c) {
        return String.fromCharCode(c.charCodeAt(0) + (c.toLowerCase() < "n" ? 13 : -13));
    });
    const final = rot13.split("").reverse().join("");
    try {
        return Buffer.from(final, 'base64').toString('utf-8');
    } catch (e) {
        return final;
    }
}

export function GTAxQyTyBx(str: string): string {
    const reversed = str.split("").reverse().join("");
    let result = "";
    for (let i = 0; i < reversed.length; i += 2) {
        result += reversed[i];
    }
    try {
        return Buffer.from(result, 'base64').toString('utf-8');
    } catch (e) {
        return result;
    }
}

export function C66jPHx8qu(str: string): string {
    const reversed = str.split("").reverse().join("");
    const key = "X9a(O;FMV2-7VO5x;Ao :dN1NoFs?j,";
    const matches = reversed.match(/.{1,2}/g);
    if (!matches) return "";
    const decoded = matches.map(x => String.fromCharCode(parseInt(x, 16))).join("");
    let result = "";
    for (let i = 0; i < decoded.length; i++) {
        result += String.fromCharCode(
            decoded.charCodeAt(i) ^ key.charCodeAt(i % key.length),
        );
    }
    return result;
}

export function MyL1IRSfHe(str: string): string {
    const reversed = str.split("").reverse().join("");
    let res1 = "";
    for (let i = 0; i < reversed.length; i++) {
        res1 += String.fromCharCode(reversed.charCodeAt(i) - 1);
    }
    let res2 = "";
    for (let i = 0; i < res1.length; i += 2) {
        res2 += String.fromCharCode(parseInt(res1.substr(i, 2), 16));
    }
    return res2;
}

export function detdj7JHiK(str: string): string {
    const sliced = str.slice(10, -16);
    const key = "3SAY~#%Y(V%>5d/Yg\"$G[Lh1rK4a;7ok";
    const decoded = Buffer.from(sliced, 'base64').toString('binary');
    const repeatedKey = key.repeat(Math.ceil(decoded.length / key.length)).substring(0, decoded.length);
    let result = "";
    for (let i = 0; i < decoded.length; i++) {
        result += String.fromCharCode(decoded.charCodeAt(i) ^ repeatedKey.charCodeAt(i));
    }
    return result;
}

export function nZlUnj2VSo(str: string): string {
    const map: Record<string, string> = {
        x: "a", y: "b", z: "c", a: "d", b: "e", c: "f", d: "g", e: "h", f: "i", g: "j",
        h: "k", i: "l", j: "m", k: "n", l: "o", m: "p", n: "q", o: "r", p: "s", q: "t",
        r: "u", s: "v", t: "w", u: "x", v: "y", w: "z",
        X: "A", Y: "B", Z: "C", A: "D", B: "E", C: "F", D: "G", E: "H", F: "I", G: "J",
        H: "K", I: "L", J: "M", K: "N", L: "O", M: "P", N: "Q", O: "R", P: "S", Q: "T",
        R: "U", S: "V", T: "W", U: "X", V: "Y", W: "Z",
    };
    return str.replace(/[xyzabcdefghijklmnopqrstuvwXYZABCDEFGHIJKLMNOPQRSTUVW]/g, function (c) {
        return map[c];
    });
}

export function laM1dAi3vO(str: string): string {
    const reversed = str.split("").reverse().join("");
    const base64 = reversed.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = Buffer.from(base64, 'base64').toString('binary');
    let result = "";
    const shift = 5;
    for (let i = 0; i < decoded.length; i++) {
        result += String.fromCharCode(decoded.charCodeAt(i) - shift);
    }
    return result;
}

export function GuxKGDsA2T(str: string): string {
    const reversed = str.split("").reverse().join("");
    const base64 = reversed.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = Buffer.from(base64, 'base64').toString('binary');
    let result = "";
    const shift = 7;
    for (let i = 0; i < decoded.length; i++) {
        result += String.fromCharCode(decoded.charCodeAt(i) - shift);
    }
    return result;
}

export function LXVUMCoAHJ(str: string): string {
    const reversed = str.split("").reverse().join("");
    const base64 = reversed.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = Buffer.from(base64, 'base64').toString('binary');
    let result = "";
    const shift = 3;
    for (let i = 0; i < decoded.length; i++) {
        result += String.fromCharCode(decoded.charCodeAt(i) - shift);
    }
    return result;
}

export function decrypt(param: string, type: string): string | null {
    switch (type) {
        case "LXVUMCoAHJ": return LXVUMCoAHJ(param);
        case "GuxKGDsA2T": return GuxKGDsA2T(param);
        case "laM1dAi3vO": return laM1dAi3vO(param);
        case "nZlUnj2VSo": return nZlUnj2VSo(param);
        case "Iry9MQXnLs": return Iry9MQXnLs(param);
        case "IGLImMhWrI": return IGLImMhWrI(param);
        case "GTAxQyTyBx": return GTAxQyTyBx(param);
        case "C66jPHx8qu": return C66jPHx8qu(param);
        case "MyL1IRSfHe": return MyL1IRSfHe(param);
        case "detdj7JHiK": return detdj7JHiK(param);
        case "bMGyx71TzQLfdonN": return bMGyx71TzQLfdonN(param);
        default: return null;
    }
}
