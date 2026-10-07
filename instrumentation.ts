export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateEnvironment } = await import("@/lib/config/validateEnv");
    validateEnvironment();
  }
}
