import { createClientForServer } from "@/utils/supabase/server";
export default async function Instruments() {
  const supabase = await createClientForServer();
  console.log("supabase", supabase);
  const { data: instruments } = await supabase.from("instruments").select();
  return <pre>{JSON.stringify(instruments, null, 2)}</pre>;
}
