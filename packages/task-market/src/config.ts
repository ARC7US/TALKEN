import { config as loadEnv } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { z } from "zod";

// Load .env from project root (two levels up from packages/task-market/src)
const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, "../../../.env") });

const envSchema = z.object({
  STELLAR_MODE: z.enum(["mock", "testnet", "mainnet"]).default("mock"),
  PORT: z.coerce.number().int().positive().default(3001),
  HOST: z.string().default("0.0.0.0"),
  MOCK_AUTH: z.coerce.boolean().default(true),
  IOTA_ADMIN_PRIVATE_KEY: z.string().optional(),
  TALKEN_CONTRACT_PACKAGE_ID: z.string().optional(),
  TREASURY_CAP_ID: z.string().optional(),
  ADMIN_CAP_ID: z.string().optional(),
});

const parsed = envSchema.safeParse({
  STELLAR_MODE: process.env.STELLAR_MODE,
  PORT: process.env.PORT,
  HOST: process.env.HOST,
  MOCK_AUTH: process.env.MOCK_AUTH,
  IOTA_ADMIN_PRIVATE_KEY: process.env.IOTA_ADMIN_PRIVATE_KEY,
  TALKEN_CONTRACT_PACKAGE_ID: process.env.TALKEN_CONTRACT_PACKAGE_ID,
  TREASURY_CAP_ID: process.env.TREASURY_CAP_ID,
  ADMIN_CAP_ID: process.env.ADMIN_CAP_ID,
});

if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
export type Config = z.infer<typeof envSchema>;
