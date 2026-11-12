export {};
// usage: bun run hash-password 'my password'   (or omit the arg to be prompted)
let pw = process.argv[2];
if (!pw) { pw = prompt("Password:") ?? ""; }
if (!pw) { console.error("no password given"); process.exit(1); }
console.log(await Bun.password.hash(pw, { algorithm: "argon2id" }));
console.error("\nSet this as APP_PASSWORD_HASH (in a .env file wrap it in SINGLE quotes: it contains $ characters).");
