using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace RiaCastShell
{
    internal static class Program
    {
        internal const string AppUrl = "https://riacaya.github.io/RiaCast/";
        internal const string AppName = "RiaCast";
        internal const string ShellVersion = "1.0";
        private static string _logFile;

        [STAThread]
        static void Main(string[] args)
        {
            bool created;
            using (var mutex = new Mutex(true, "Local\\RiaCastShell-SingleInstance", out created))
            {
                if (!created) return;

                string dataDir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "RiaCast");
                try { Directory.CreateDirectory(dataDir); } catch { }
                _logFile = Path.Combine(dataDir, "riacast-shell.log");
                Log("RiaCast Shell start " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"));

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                try
                {
                    Application.Run(new MainForm());
                }
                catch (Exception ex)
                {
                    Log("Fatal: " + ex.ToString());
                    MessageBox.Show("RiaCast gagal dimulai:\n" + ex.Message, AppName,
                        MessageBoxButtons.OK, MessageBoxIcon.Error);
                }
            }
        }

        internal static void Log(string s)
        {
            try
            {
                if (_logFile == null) return;
                try
                {
                    var fi = new FileInfo(_logFile);
                    if (fi.Exists && fi.Length > 1024 * 1024) fi.Delete();
                }
                catch { }
                File.AppendAllText(_logFile, DateTime.Now.ToString("HH:mm:ss") + "  " + s + "\r\n");
            }
            catch { }
        }

        internal static string AppDir
        {
            get
            {
                try { return Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location) ?? "."; }
                catch { return "."; }
            }
        }
    }

    internal class MainForm : Form
    {
        private WebView2 _web;

        internal MainForm()
        {
            Text = "RiaCast";
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(1280, 800);
            MinimumSize = new Size(420, 560);
            AutoScaleMode = AutoScaleMode.Font;
            try { Icon = LoadAppIcon(); } catch { }
            Shown += async delegate(object s, EventArgs e) { await InitWebViewAsync(); };
        }

        internal static Icon LoadAppIcon()
        {
            string png = Path.Combine(Program.AppDir, "assets", "logo-192.png");
            if (File.Exists(png))
            {
                try
                {
                    using (var bmp = new Bitmap(png))
                    {
                        IntPtr h = bmp.GetHicon();
                        Icon ico = Icon.FromHandle(h);
                        return (Icon)ico.Clone();
                    }
                }
                catch { }
            }
            return SystemIcons.Application;
        }

        private async System.Threading.Tasks.Task InitWebViewAsync()
        {
            try
            {
                string profile = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "RiaCast", "WebView2");
                var env = await CoreWebView2Environment.CreateAsync(null, profile, null);
                _web = new WebView2();
                _web.Dock = DockStyle.Fill;
                Controls.Add(_web);
                _web.BringToFront();
                await _web.EnsureCoreWebView2Async(env);
                _web.CoreWebView2.Settings.IsStatusBarEnabled = false;
                _web.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
                _web.CoreWebView2.Settings.IsWebMessageEnabled = false;
                _web.CoreWebView2.Settings.AreDevToolsEnabled = true;
                _web.CoreWebView2.Settings.AreBrowserAcceleratorKeysEnabled = true;
                _web.CoreWebView2.NewWindowRequested += delegate(object s, CoreWebView2NewWindowRequestedEventArgs e)
                {
                    var uri = e.Uri ?? "";
                    if (uri.StartsWith("http://") || uri.StartsWith("https://"))
                    {
                        if (!uri.StartsWith(Program.AppUrl, StringComparison.OrdinalIgnoreCase))
                        {
                            e.Handled = true;
                            try { Process.Start(new ProcessStartInfo(uri) { UseShellExecute = true }); } catch { }
                            return;
                        }
                    }
                    e.Handled = true;
                    if (!string.IsNullOrEmpty(uri)) _web.CoreWebView2.Navigate(uri);
                };
                _web.CoreWebView2.PermissionRequested += delegate(object s, CoreWebView2PermissionRequestedEventArgs e)
                {
                    if (e.PermissionKind == CoreWebView2PermissionKind.Microphone ||
                        e.PermissionKind == CoreWebView2PermissionKind.Camera ||
                        e.PermissionKind == CoreWebView2PermissionKind.Notifications)
                    {
                        var u = e.Uri ?? "";
                        if (u.StartsWith("https://riacaya.github.io/", StringComparison.OrdinalIgnoreCase))
                            e.State = CoreWebView2PermissionState.Allow;
                    }
                };
                _web.Source = new Uri(Program.AppUrl);
                Program.Log("WebView ready: " + Program.AppUrl);
            }
            catch (Exception ex)
            {
                Program.Log("WebView2 init failed: " + ex.Message);
                MessageBox.Show(this,
                    "Runtime Microsoft Edge WebView2 tidak tersedia.\n\nUnduh dan pasang:\nhttps://developer.microsoft.com/microsoft-edge/webview2/\n\nDetail: " + ex.Message,
                    Program.AppName, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                Close();
            }
        }
    }
}
