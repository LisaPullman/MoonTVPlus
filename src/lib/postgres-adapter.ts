/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Postgres adapter (provider-agnostic)
 *
 * This wraps a standard Postgres connection (via `pg`) behind the same
 * D1-like adapter interface used elsewhere in the codebase.
 *
 * Notes:
 * - Server-only (middleware runs on Edge and must not import this file).
 * - Works with any Postgres provider (Neon/Supabase/RDS/etc) as long as
 *   a connection string is provided via env.
 */

import { Pool, PoolClient } from 'pg';
import { DatabaseAdapter, D1PreparedStatement, D1Result } from './d1-adapter';

function getPostgresConnectionString(): string {
  const url = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'Postgres connection string missing. Set POSTGRES_URL (preferred) or DATABASE_URL.'
    );
  }
  return url;
}

function getPool(): Pool {
  const g = globalThis as unknown as {
    __moontv_pg_pool__?: Pool;
  };

  if (!g.__moontv_pg_pool__) {
    g.__moontv_pg_pool__ = new Pool({
      connectionString: getPostgresConnectionString(),
    });
  }

  return g.__moontv_pg_pool__;
}

export class PostgresAdapter implements DatabaseAdapter {
  prepare(query: string): D1PreparedStatement {
    return new PostgresPreparedStatement(query);
  }

  async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    const pool = getPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      const results: D1Result[] = [];
      for (const stmt of statements) {
        const pgStmt = stmt as unknown as PostgresPreparedStatement;
        results.push(await pgStmt.executeWithClient(client));
      }
      await client.query('COMMIT');
      return results;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignore rollback failures
      }
      throw err;
    } finally {
      client.release();
    }
  }

  exec(_query: string): void {
    throw new Error('exec() is not supported for Postgres adapter. Use prepare() instead.');
  }
}

class PostgresPreparedStatement implements D1PreparedStatement {
  private params: any[] = [];

  constructor(private query: string) {}

  bind(...values: any[]): D1PreparedStatement {
    this.params = values;
    return this;
  }

  private convertQuery(query: string): string {
    // Support SQLite-style '?' placeholders in a few legacy call sites.
    if (!query.includes('?')) {
      return query;
    }

    let index = 1;
    return query.replace(/\?/g, () => `$${index++}`);
  }

  async first<T = any>(colName?: string): Promise<T | null> {
    try {
      const result = await this.executeQuery(getPool());
      if (!result.rows || result.rows.length === 0) return null;

      const row = result.rows[0] as any;
      if (colName) return row[colName] ?? null;
      return row as T;
    } catch (err) {
      console.error('Postgres first() error:', err);
      return null;
    }
  }

  async run<T = any>(): Promise<D1Result<T>> {
    try {
      const result = await this.executeQuery(getPool());
      return {
        success: true,
        meta: {
          changes: result.rowCount || 0,
          last_row_id: null,
        },
        results: result.rows as any,
      };
    } catch (err: any) {
      console.error('Postgres run() error:', err);
      return {
        success: false,
        error: err?.message || String(err),
      };
    }
  }

  async all<T = any>(): Promise<D1Result<T>> {
    try {
      const result = await this.executeQuery(getPool());
      return {
        success: true,
        results: (result.rows || []) as any,
      };
    } catch (err: any) {
      console.error('Postgres all() error:', err);
      return {
        success: false,
        error: err?.message || String(err),
        results: [],
      };
    }
  }

  async execute(): Promise<D1Result> {
    return this.run();
  }

  async executeWithClient(client: PoolClient): Promise<D1Result> {
    try {
      const text = this.convertQuery(this.query);
      const result = await client.query(text, this.params);
      return {
        success: true,
        meta: {
          changes: result.rowCount || 0,
          last_row_id: null,
        },
        results: result.rows,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err?.message || String(err),
      };
    }
  }

  private async executeQuery(pool: Pool) {
    const text = this.convertQuery(this.query);
    return pool.query(text, this.params);
  }
}

