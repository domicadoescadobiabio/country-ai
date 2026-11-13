@echo off
rem Keeps the local brain running for weeks: if it stops (network drop, crash), it starts again after 15 s.
rem When its own code or .env.local-brain changes it exits with code 3 and starts again at once with the new code.
rem Put a shortcut to this file in the Startup folder (Win+R, shell:startup) so it also comes back after a reboot.
title COUNTRY AI - local brain (Qwen on Ollama)
cd /d "%~dp0.."
set LOCAL_BRAIN_SUPERVISED=1
rem Tuned 13 Nov 2026 for an RTX 4060 Ti 8 GB: 4 questions at a time with a 3072-token context answer about
rem 180 a minute, fully on the GPU (74 with 2 at a time and 8192 tokens, which also spilled part of the model onto the CPU).
rem Real prompts are under 1,000 tokens. These win over .env.local-brain; set them in the environment to change.
rem Ollama itself must allow it: user environment OLLAMA_NUM_PARALLEL=4, OLLAMA_FLASH_ATTENTION=1, OLLAMA_KV_CACHE_TYPE=q8_0.
if not defined PARALLEL set PARALLEL=4
if not defined OLLAMA_CTX set OLLAMA_CTX=3072
:loop
echo [%date% %time%] starting the local brain
node scripts\local-brain.mjs
if %errorlevel%==3 goto reload
echo [%date% %time%] the local brain stopped, restarting in 15 seconds (close this window to stop it)
timeout /t 15 /nobreak >nul
goto loop
:reload
echo [%date% %time%] new code for the local brain, restarting now
timeout /t 2 /nobreak >nul
goto loop
