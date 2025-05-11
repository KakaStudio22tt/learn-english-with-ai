"use client";

import Image from "next/image";
import { createClient } from "@/utils/supabase/client";

export default function LoginPage() {
  const supabase = createClient();

  const signInWithGoogle = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${location.origin}/auth/callback/`, // đường dẫn redirect sau khi đăng nhập
      },
    });
  };

  return (
    <div className="flex flex-col md:flex-row min-h-screen">
      {/* Left image - ẩn trên mobile */}
      <div className="hidden md:block md:w-1/2 relative">
        <Image
          src="/images/background.jpg"
          alt="Lighthouse"
          layout="fill"
          objectFit="cover"
        />
        <p className="absolute bottom-2 left-2 text-white text-xs">
          Photo by Alexandr Popadin
        </p>
      </div>

      {/* Right form */}
      <div className="w-full md:w-1/2 flex items-center justify-center p-6 sm:p-12">
        <div className="max-w-md w-full space-y-6">
          <h1 className="text-2xl sm:text-3xl font-bold">
            Nice to see you again
          </h1>

          <form className="space-y-4">
            <input
              type="text"
              placeholder="Email or phone number"
              className="w-full border border-gray-300 p-3 rounded-md"
            />
            <input
              type="password"
              placeholder="Enter password"
              className="w-full border border-gray-300 p-3 rounded-md"
            />
            <div className="flex justify-between text-sm items-center">
              <label className="flex items-center gap-2">
                <input type="checkbox" />
                Remember me
              </label>
              <a href="#" className="text-blue-600 hover:underline">
                Forgot password?
              </a>
            </div>
            <button className="w-full bg-blue-600 text-white py-3 rounded-md hover:bg-blue-700">
              Sign in
            </button>
          </form>

          <div className="text-center">
            <p className="text-sm text-gray-500">Or sign in with Google</p>
            <button
              onClick={signInWithGoogle}
              className="mt-2 w-full border flex items-center justify-center gap-2 border-gray-300 py-2 rounded-md hover:bg-gray-100"
            >
              <img src="/icons8-google.svg" className="w-5 h-5" />
              <span>Sign in with Google</span>
            </button>
          </div>

          <div className="text-center text-sm text-gray-600">
            Don’t have an account?{" "}
            <a href="#" className="text-blue-600 hover:underline">
              Sign up now
            </a>
          </div>

          <div className="flex">
            <Image
              src="/images/logo.png"
              alt="UI Unicorn"
              width={100}
              height={100}
              className="mr-auto "
            />
            <p className="text-xs text-gray-400 mt-13 mr-0">
              © Perfect Login 2025
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
