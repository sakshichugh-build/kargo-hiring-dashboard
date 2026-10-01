import Dashboard from "@/components/Dashboard";
import { getResults } from "@/lib/data";

export const dynamic = "force-dynamic";

export default function Home() {
  const results = getResults();
  return <Dashboard results={results} />;
}
