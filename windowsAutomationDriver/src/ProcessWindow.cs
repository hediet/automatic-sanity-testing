using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace WindowsAutomationDriver
{
    class ProcessWindow(Process process, string title, nint hwnd)
    {
        // Windows API declarations
        [DllImport("user32.dll")]
        private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, nint lParam);

        [DllImport("user32.dll")]
        private static extern uint GetWindowThreadProcessId(nint hWnd, out uint lpdwProcessId);

        [DllImport("user32.dll")]
        private static extern int GetWindowText(nint hWnd, StringBuilder lpString, int nMaxCount);

        [DllImport("user32.dll")]
        private static extern bool IsWindowVisible(nint hWnd);

        private delegate bool EnumWindowsProc(nint hWnd, nint lParam);

        public static ProcessWindow[] GetAllFromProcess(Process process)
        {
            var windows = new List<ProcessWindow>();
            var processId = (uint)process.Id;

            EnumWindows((hWnd, lParam) =>
            {
                GetWindowThreadProcessId(hWnd, out uint windowProcessId);

                // Check if this window belongs to our process and is visible
                if (windowProcessId == processId && IsWindowVisible(hWnd))
                {
                    var title = GetWindowTitle(hWnd);
                    if (!string.IsNullOrEmpty(title))
                    {
                        windows.Add(new ProcessWindow(process, title, hWnd));
                    }
                }

                return true; // Continue enumeration
            }, nint.Zero);

            return windows.ToArray();
        }

        private static string GetWindowTitle(nint hWnd)
        {
            const int maxLength = 256;
            var title = new StringBuilder(maxLength);
            int length = GetWindowText(hWnd, title, maxLength);
            return length > 0 ? title.ToString() : string.Empty;
        }

        public string Title { get; private set; } = title;
        public Process Process { get; private set; } = process;
        public nint Handle { get; private set; } = hwnd;
    }
}
