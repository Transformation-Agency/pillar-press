export const metadata = {
  title: "Pillar Press",
  description: "Editorial workstation backend",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
