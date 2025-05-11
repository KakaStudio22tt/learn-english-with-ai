"use server";

import { createClient } from "@/utils/supabase/server"; // hoặc hàm createClient bạn viết
import { redirect } from "next/navigation";

export default async function Callback() {
  const supabase = await createClient();
  console.log("supabase", supabase);
  // Supabase tự xử lý session qua cookie
  const {
    data: { session },
  } = await supabase.auth.getSession();

  // Nếu có session => redirect về trang chính
  if (session) {
    redirect("/dashboard"); // hoặc trang nào bạn muốn
  }

  // Nếu chưa có session thì có thể hiển thị đang xử lý
  return <p>Đang đăng nhập...</p>;
}
