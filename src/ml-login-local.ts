// Login ML no PC usando o .env de produção: grava a sessão em ./data/ml_auth
// (em vez de /app/data/ml_auth, que no Windows vira C:\app\data\ml_auth) e abre navegador visível.
// Depois copie ./data/ml_auth para o volume /app/data/ml_auth do servidor.
process.env.ML_AUTH_PATH = './data/ml_auth';
process.env.ML_BROWSER_HEADLESS = 'false';
process.env.ML_LOGIN_CDP_URL = '';

await import('./ml-login.js');
