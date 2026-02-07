/**
 * Vercel Postgres 数据库初始化脚本
 *
 * 创建数据库表结构并初始化默认管理员用户
 */

const { Client } = require('pg');
const crypto = require('crypto');

// SHA-256 加密密码
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

console.log('📦 Initializing Postgres database...');

// 读取迁移脚本
const fs = require('fs');
const path = require('path');

const sqlPath = path.join(__dirname, '../migrations/postgres/001_initial_schema.sql');
if (!fs.existsSync(sqlPath)) {
  console.error('❌ Migration file not found:', sqlPath);
  process.exit(1);
}

const schemaSql = fs.readFileSync(sqlPath, 'utf8');

async function init() {
  const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('❌ Missing POSTGRES_URL (preferred) or DATABASE_URL environment variable.');
    process.exit(1);
  }

  const client = new Client({ connectionString });

  try {
    await client.connect();

    // 执行 schema 创建
    console.log('🔧 Creating database schema...');
    await client.query(schemaSql);
    console.log('✅ Database schema created successfully!');

    // 创建默认管理员用户
    const username = process.env.USERNAME || 'admin';
    const password = process.env.PASSWORD || '123456789';
    const passwordHash = hashPassword(password);

    console.log('👤 Creating default admin user...');
    await client.query(
      `
        INSERT INTO users (username, password_hash, role, created_at, playrecord_migrated, favorite_migrated, skip_migrated)
        VALUES ($1, $2, 'owner', $3, 1, 1, 1)
        ON CONFLICT (username) DO NOTHING
      `,
      [username, passwordHash, Date.now()]
    );
    console.log(`✅ Default admin user created: ${username}`);

    console.log('');
    console.log('🎉 Postgres database initialized successfully!');
    console.log('');
    console.log('Next steps:');
    console.log('1. Set NEXT_PUBLIC_STORAGE_TYPE=postgres in .env');
    console.log('2. Set POSTGRES_URL environment variable');
    console.log('3. Run: npm run dev');
  } catch (err) {
    console.error('❌ Initialization failed:', err);
    process.exit(1);
  } finally {
    try {
      await client.end();
    } catch {
      // ignore
    }
  }
}

init();
