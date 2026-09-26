// Räumt nach den Browser-Tests die Container des Docker-Modus (E2E_DOCKER=1) ab
import { execFileSync } from "child_process";

export default function teardown() {
  if (!process.env.E2E_DOCKER) return;
  for (const name of ["drivingbook-e2e-frontend", "drivingbook-e2e-backend"]) {
    try { execFileSync("docker", ["rm", "-f", name], { stdio: "ignore" }); } catch { /* schon weg */ }
  }
}
