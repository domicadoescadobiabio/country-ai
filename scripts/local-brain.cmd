@echo off
rem Keeps the local brain running for weeks: if it stops (network drop, crash), it starts again after 15 s.
rem When its own code or .env.local-brain changes it exits with code 3 and starts again at once with the new code.
rem Put a shortcut to this file in the Startup folder (Win+R, shell:startup) so it also comes back after a reboot.
title COUNTRY AI - local brain (Qwen)
cd /d "%~dp0.."
set LOCAL_BRAIN_SUPERVISED=1
if not defined PARALLEL set PARALLEL=4
if not defined OLLAMA_CTX set OLLAMA_CTX=3072
goto setup
rem Backend: LOCAL_BACKEND=llamacpp (the default here, 14 Nov 2026) answers with llama-server and the LoRA
rem trained on the republic's lessons; LLAMA_START starts llama-server when LLAMA_URL does not answer.
rem LOCAL_BACKEND=ollama runs on Ollama. Set it in the environment or in .env.local-brain. The two do not
rem fit in 8 GB of VRAM together. Tuned 13 Nov 2026 for an RTX 4060 Ti 8 GB: 4 at a time, 3072 tokens.
rem Byte 1079 (next line): an older window lands here after a reload and stays on Ollama.
rem --------------------------------------
if not defined LOCAL_BACKEND set LOCAL_BACKEND=ollama
goto loop
rem The line above "goto loop" sits at byte 1079, where a window started with the older version of this
rem file (14 Nov 2026) goes on reading once its runner reloads: such a window stays on Ollama until it is
rem closed and started again. New windows jump over it (goto setup). Keep the bytes before it as they are.
:setup
if exist ".env.local-brain" for /f "usebackq eol=# tokens=1,* delims==" %%a in (".env.local-brain") do (
  if /i "%%a"=="LOCAL_BACKEND" if not defined LOCAL_BACKEND set "LOCAL_BACKEND=%%b"
  if /i "%%a"=="LLAMA_URL" if not defined LLAMA_URL set "LLAMA_URL=%%b"
  if /i "%%a"=="LLAMA_START" if not defined LLAMA_START set "LLAMA_START=%%b"
)
if not defined LOCAL_BACKEND set LOCAL_BACKEND=llamacpp
if not defined LLAMA_URL set LLAMA_URL=http://127.0.0.1:8091
if not defined LLAMA_START set "LLAMA_START=C:\Users\User\Downloads\lora-lab\start-llama.cmd"
:loop
if /i "%LOCAL_BACKEND%"=="llamacpp" call :llama
echo [%date% %time%] starting the local brain (%LOCAL_BACKEND%)
node scripts\local-brain.mjs
if %errorlevel%==3 goto reload
echo [%date% %time%] the local brain stopped, restarting in 15 seconds (close this window to stop it)
timeout /t 15 /nobreak >nul
goto loop
:reload
echo [%date% %time%] new code for the local brain, restarting now
timeout /t 2 /nobreak >nul
goto loop

rem llama-server: started in its own window when nothing answers at LLAMA_URL (Ollama's copy of the model is
rem unloaded first, the two do not fit together), then up to 120 s for /health to say ok
:llama
curl -s -o nul "%LLAMA_URL%/health" && goto llamawait
echo [%date% %time%] llama-server is not answering at "%LLAMA_URL%": starting "%LLAMA_START%"
where ollama >nul 2>&1 && ollama stop qwen3:8b >nul 2>&1
start "llama" /min "%LLAMA_START%"
:llamawait
set /a LLAMA_WAITED=0
:llamacheck
curl -sf -o nul "%LLAMA_URL%/health" && exit /b 0
if %LLAMA_WAITED% geq 120 echo [%date% %time%] llama-server is still not ready after 120 seconds& exit /b 1
timeout /t 2 /nobreak >nul
set /a LLAMA_WAITED+=2
goto llamacheck
