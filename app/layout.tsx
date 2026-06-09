export const metadata = {
  title: "King's Press Editorial Desk",
  description: "Local-first editorial workstation",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
