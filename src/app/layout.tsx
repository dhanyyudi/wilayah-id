import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export const metadata: Metadata = {
  metadataBase: new URL("https://wilayah-id-restapi.vercel.app"),
  title: "wilayah-id — Batas Administrasi Indonesia",
  description:
    "Peta interaktif batas administrasi Indonesia: 38 provinsi, 514 kabupaten/kota, 7.285 kecamatan, 83.762 desa/kelurahan. API REST gratis & open source.",
  keywords: [
    "batas administrasi indonesia",
    "peta indonesia",
    "wilayah indonesia",
    "kode wilayah",
    "GIS indonesia",
    "vector tiles",
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
