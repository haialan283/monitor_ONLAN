/**
 * Entry point: load env, validate SECRET_KEY, then start app.
 * Chạy: npm start  hoặc  node server.js
 * Cấu hình: copy .env.example thành .env và điền SECRET_KEY (bắt buộc).
 */
require('dotenv').config();
require('./config').getSecretKey();
require('./index');
