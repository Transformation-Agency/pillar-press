export const metadata = {
  title: "Pillar Press",
  description: "Local-first content generation workstation",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
