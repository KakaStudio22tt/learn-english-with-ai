export const metadata = {
  title: "Giới thiệu",
  description: "Trang giới thiệu về ứng dụng của chúng tôi.",
};

export default function AboutPage() {
  return (
    <main className="min-h-screen px-6 py-12 bg-white text-gray-900">
      <h1 className="text-3xl font-bold mb-4">Giới thiệu</h1>
      <p className="text-lg">
        Đây là một ứng dụng học tiếng Anh giúp bạn ghi nhớ từ vựng hiệu quả hơn
        bằng cách kết hợp AI, trò chơi và hệ thống ôn tập thông minh.
      </p>

      <div className="mt-6">
        <h2 className="text-2xl font-semibold mb-2">Chức năng chính:</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>Tra cứu và lưu từ vựng</li>
          <li>Học từ mới với flashcard</li>
          <li>Ôn tập theo Spaced Repetition</li>
          <li>Gợi ý từ mới bằng AI</li>
        </ul>
      </div>
    </main>
  );
}
