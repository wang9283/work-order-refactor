@echo off
cd /d C:\Users\Miao\Projects\EastHope\Feed-test-work-order-refactor

git init
git add .
git commit -m "work-order-refactor v2.0 prototype"
git branch -M main
git remote remove origin 2>nul
git remote add origin https://github.com/wang9283/work-order-refactor.git
git push -u origin main
