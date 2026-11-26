// RiaCast Setup - pemasang Windows (setup.exe)
// Menyalin paket cangkang RiaCast ke folder pemasangan, membuat pintasan, dan opsional menjalankan.
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;

namespace RiaCastSetup
{
    class Program
    {
        static string Src;
        static string Dst;
        static bool Langsung = true;
        static bool Pintasan = true;
        static bool Kering = false;

        static readonly string[] SkipFile = { "setup.exe", "Setup.cs", "riacast-setup.log" };
        static readonly string[] SkipDir = { "tools\\installer", "tools\\shell\\shell-libs" };

        static int Main(string[] args)
        {
            try { Console.Title = "RiaCast Setup"; } catch { }

            Src = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location) ?? ".";
            Dst = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Programs", "RiaCast");

            if (!BacaArgumen(args)) return 1;

            Tulis("");
            Tulis("  RiaCast - pemasangan ke Windows");
            Tulis("  Sumber : " + Src);
            Tulis("  Tujuan : " + Dst);
            Tulis("");

            if (Kering)
            {
                Tulis("  [kering] tidak ada yang diubah.");
                Tulis("  [kering] RiaCast.exe ada: " + (File.Exists(Path.Combine(Src, "RiaCast.exe")) ? "ya" : "TIDAK"));
                Tulis("");
                return 0;
            }

            if (!File.Exists(Path.Combine(Src, "RiaCast.exe")))
            {
                Gagal("RiaCast.exe tidak ditemukan di folder ini. Pastikan setup.exe berada bersama paket RiaCast.");
                return 1;
            }

            try
            {
                if (!Directory.Exists(Dst)) Directory.CreateDirectory(Dst);
            }
            catch (Exception e)
            {
                Gagal("tidak bisa membuat folder tujuan: " + e.Message);
                return 1;
            }

            Tulis("   [1/2] Menyalin berkas aplikasi...");
            long bytes = 0; int files = 0;
            if (Path.GetFullPath(Src).TrimEnd('\\').Equals(Path.GetFullPath(Dst).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase))
            {
                Tulis("         Folder tujuan = folder sumber - penyalinan dilewati.");
            }
            else
            {
                try
                {
                    Salin(Src, Dst, ref bytes, ref files);
                    Tulis("         " + files + " berkas, " + Mb(bytes) + " MB - selesai.");
                }
                catch (Exception e)
                {
                    Gagal("penyalinan gagal: " + e.Message);
                    return 1;
                }
            }

            if (Pintasan)
            {
                Tulis("   [2/2] Membuat pintasan Start Menu dan Desktop...");
                string err = BuatPintasan();
                if (err != null)
                {
                    Tulis("   Peringatan: pintasan gagal (" + err + ").");
                    Tulis("         Aplikasi tetap bisa dibuka dari: " + Path.Combine(Dst, "RiaCast.exe"));
                }
                else
                {
                    Tulis("         Pintasan dibuat.");
                }
            }

            Tulis("");
            Tulis("   Pemasangan selesai.");
            Tulis("     Aplikasi  : " + Dst);
            Tulis("     Cara buka : pintasan \"RiaCast\" (Desktop / Start Menu)");
            Tulis("     Cangkang  : memuat https://riacaya.github.io/RiaCast/ (update via GitHub)");
            Tulis("     Copot     : hapus folder di atas + pintasannya");
            Tulis("");

            if (Langsung)
            {
                Console.Write("   Jalankan RiaCast sekarang? [Y/N] ");
                string jawab = Console.ReadLine();
                if (jawab != null && jawab.Trim().StartsWith("Y", StringComparison.OrdinalIgnoreCase))
                {
                    try { Process.Start(Path.Combine(Dst, "RiaCast.exe")); }
                    catch (Exception e) { Tulis("   Gagal menjalankan: " + e.Message); }
                }
            }
            Tulis("");
            return 0;
        }

        static bool BacaArgumen(string[] args)
        {
            for (int i = 0; i < args.Length; i++)
            {
                string a = args[i];
                if (string.Equals(a, "--ke", StringComparison.OrdinalIgnoreCase))
                {
                    if (i + 1 >= args.Length) { Gagal("--ke butuh nama folder."); return false; }
                    i++; Dst = args[i];
                }
                else if (string.Equals(a, "--tanpa-jalankan", StringComparison.OrdinalIgnoreCase)) Langsung = false;
                else if (string.Equals(a, "--tanpa-pintasan", StringComparison.OrdinalIgnoreCase)) Pintasan = false;
                else if (string.Equals(a, "--kering", StringComparison.OrdinalIgnoreCase)) Kering = true;
                else if (string.Equals(a, "--bantu", StringComparison.OrdinalIgnoreCase) || a == "-h" || a == "/?")
                {
                    Tulis("  Pilihan:");
                    Tulis("    --ke \"D:\\RiaCast\"      pasang ke folder pilihan");
                    Tulis("    --tanpa-jalankan        jangan langsung menjalankan");
                    Tulis("    --tanpa-pintasan        jangan membuat pintasan");
                    Tulis("    --kering                cetak rencana tanpa mengubah apa pun");
                    return false;
                }
            }
            return true;
        }

        static bool HarusLewat(string relPath, bool isDir)
        {
            string rel = relPath.Replace('/', '\\').TrimStart('\\');
            string name = Path.GetFileName(rel);
            if (isDir)
            {
                for (int i = 0; i < SkipDir.Length; i++)
                {
                    string s = SkipDir[i];
                    if (rel.Equals(s, StringComparison.OrdinalIgnoreCase) || rel.StartsWith(s + "\\", StringComparison.OrdinalIgnoreCase)) return true;
                }
                return false;
            }
            for (int i = 0; i < SkipFile.Length; i++) if (name.Equals(SkipFile[i], StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }

        static void Salin(string src, string dst, ref long bytes, ref int files)
        {
            if (!Directory.Exists(dst)) Directory.CreateDirectory(dst);
            foreach (string file in Directory.GetFiles(src))
            {
                string rel = file.Substring(Src.Length);
                if (HarusLewat(rel, false)) continue;
                string to = Path.Combine(dst, Path.GetFileName(file));
                File.Copy(file, to, true);
                try { bytes += new FileInfo(file).Length; } catch { }
                files++;
            }
            foreach (string dir in Directory.GetDirectories(src))
            {
                string rel = dir.Substring(Src.Length);
                if (HarusLewat(rel, true)) continue;
                Salin(dir, Path.Combine(dst, Path.GetFileName(dir)), ref bytes, ref files);
            }
        }

        static string BuatPintasan()
        {
            try
            {
                string target = Path.Combine(Dst, "RiaCast.exe");
                string startMenu = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs");
                string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                BuatLnk(Path.Combine(startMenu, "RiaCast.lnk"), target, Dst);
                BuatLnk(Path.Combine(desktop, "RiaCast.lnk"), target, Dst);
                return null;
            }
            catch (Exception e) { return e.Message; }
        }

        static void BuatLnk(string lnkPath, string target, string workDir)
        {
            // WScript.Shell COM - tanpa referensi tambahan
            Type t = Type.GetTypeFromProgID("WScript.Shell");
            object shell = Activator.CreateInstance(t);
            object shortcut = t.InvokeMember("CreateShortcut", System.Reflection.BindingFlags.InvokeMethod, null, shell, new object[] { lnkPath });
            Type st = shortcut.GetType();
            st.InvokeMember("TargetPath", System.Reflection.BindingFlags.SetProperty, null, shortcut, new object[] { target });
            st.InvokeMember("WorkingDirectory", System.Reflection.BindingFlags.SetProperty, null, shortcut, new object[] { workDir });
            st.InvokeMember("Description", System.Reflection.BindingFlags.SetProperty, null, shortcut, new object[] { "RiaCast" });
            st.InvokeMember("IconLocation", System.Reflection.BindingFlags.SetProperty, null, shortcut, new object[] { target + ",0" });
            st.InvokeMember("Save", System.Reflection.BindingFlags.InvokeMethod, null, shortcut, null);
            Marshal.FinalReleaseComObject(shortcut);
            Marshal.FinalReleaseComObject(shell);
        }

        static string Mb(long bytes) { return (bytes / 1024d / 1024d).ToString("0.0"); }

        static void Tulis(string s) { try { Console.WriteLine(s); } catch { } }
        static void Gagal(string s) { Tulis(""); Tulis("  GAGAL: " + s); Tulis(""); }
    }
}
