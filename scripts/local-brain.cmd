@echo off
rem Keeps the local brain running for weeks: if it stops (network drop, crash), it starts again after 15 s.
rem Put a shortcut to this file in the Startup folder (Win+R, shell:startup) so it also comes back after a reboot.
title COUNTRY AI - local brain (Qwen on Ollama)
cd /d "%~dp0.."
:loop
echo [%date% %time%] starting the local brain
node scripts\local-brain.mjs
echo [%date% %time%] the local brain stopped, restarting in 15 seconds (close this window to stop it)
timeout /t 15 /nobreak >nul
goto loop
