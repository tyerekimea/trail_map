# Git Workflow - Trail Map Repository

## ✅ Repository Setup Complete

Your code is now connected to: **https://github.com/tyerekimea/trail_map**

---

## 🚀 Quick Commit & Push (Automated)

### **Use the Script (Recommended)**

```bash
./commit-and-push.sh "Your commit message here"
```

**Example:**
```bash
./commit-and-push.sh "Add new feature: offline maps"
./commit-and-push.sh "Fix: GPS tracking bug"
./commit-and-push.sh "Update: Backend API endpoints"
```

**What it does:**
- ✅ Stages all changes
- ✅ Excludes .env files (security)
- ✅ Commits with your message
- ✅ Adds co-author tag
- ✅ Pushes to trail_map repository
- ✅ Shows summary

---

## 📝 Manual Git Commands

### **Check Status**
```bash
git status
```

### **Stage Changes**
```bash
# Stage all changes
git add -A

# Stage specific files
git add lib/main.dart
git add backend/src/server.js

# Exclude .env files (important!)
git reset backend/.env
git reset .env
```

### **Commit Changes**
```bash
git commit -m "Your commit message" -m "Co-authored-by: Ona <no-reply@ona.com>"
```

### **Push to Trail Map**
```bash
git push trail_map main
```

### **View Commit History**
```bash
git log --oneline -10
```

---

## 🔄 Common Workflows

### **1. After Making Code Changes**
```bash
# Quick way (automated)
./commit-and-push.sh "Describe your changes"

# Manual way
git add -A
git reset backend/.env .env
git commit -m "Describe your changes"
git push trail_map main
```

### **2. Check What Changed**
```bash
# See modified files
git status

# See actual changes
git diff

# See staged changes
git diff --cached
```

### **3. View Recent Commits**
```bash
# Last 5 commits
git log --oneline -5

# Detailed view
git log -3

# With file changes
git log --stat -3
```

### **4. Undo Changes (Before Commit)**
```bash
# Discard changes to a file
git checkout -- lib/main.dart

# Unstage a file
git reset lib/main.dart

# Discard all changes
git reset --hard
```

---

## 🌿 Branch Management

### **Current Branch**
```bash
git branch
# * main
```

### **Create New Branch**
```bash
git checkout -b feature/new-feature
```

### **Switch Branch**
```bash
git checkout main
```

### **Merge Branch**
```bash
git checkout main
git merge feature/new-feature
```

---

## 🔐 Security Best Practices

### **Never Commit These Files:**
- ❌ `.env` - Contains API keys
- ❌ `backend/.env` - Contains secrets
- ❌ `*.keystore` - Android signing keys
- ❌ `node_modules/` - Dependencies (too large)
- ❌ `build/` - Build artifacts

### **Already Protected:**
The `.gitignore` file automatically excludes these files.

### **If You Accidentally Commit Secrets:**
```bash
# Remove from git but keep locally
git rm --cached .env
git commit -m "Remove .env from tracking"
git push trail_map main

# Rotate all API keys immediately!
```

---

## 📊 Repository Status

### **Current Setup:**
- ✅ **Remote**: https://github.com/tyerekimea/trail_map
- ✅ **Branch**: main
- ✅ **Last Commit**: f89b71a9
- ✅ **Status**: Up to date

### **Check Remote:**
```bash
git remote -v
# trail_map	https://github.com/tyerekimea/trail_map.git (fetch)
# trail_map	https://github.com/tyerekimea/trail_map.git (push)
```

---

## 🎯 Commit Message Guidelines

### **Good Commit Messages:**
```bash
✅ "Add offline maps feature for 8 Nigerian cities"
✅ "Fix: GPS tracking accuracy in background mode"
✅ "Update: Backend API authentication endpoints"
✅ "Refactor: Saved places database helper"
✅ "Docs: Add API documentation for subscriptions"
```

### **Bad Commit Messages:**
```bash
❌ "update"
❌ "fix bug"
❌ "changes"
❌ "wip"
❌ "asdf"
```

### **Format:**
```
<type>: <description>

Types:
- Add: New feature
- Fix: Bug fix
- Update: Modify existing feature
- Refactor: Code restructuring
- Docs: Documentation
- Style: Formatting
- Test: Add tests
- Chore: Maintenance
```

---

## 🔧 Troubleshooting

### **Problem: "Permission denied"**
```bash
# Solution: Check GitHub authentication
git remote -v
# Make sure you're using HTTPS with token or SSH with key
```

### **Problem: "Merge conflict"**
```bash
# Solution: Pull latest changes first
git pull trail_map main
# Resolve conflicts in files
git add .
git commit -m "Resolve merge conflicts"
git push trail_map main
```

### **Problem: "Detached HEAD"**
```bash
# Solution: Return to main branch
git checkout main
```

### **Problem: "Large files rejected"**
```bash
# Solution: Remove large files
git rm --cached path/to/large/file
# Add to .gitignore
echo "path/to/large/file" >> .gitignore
git commit -m "Remove large file"
```

---

## 📱 Integration with Development

### **Typical Development Workflow:**

1. **Make changes to code**
   ```bash
   # Edit files in VSCode or your editor
   ```

2. **Test changes**
   ```bash
   # For Flutter
   /tmp/flutter/bin/flutter run
   
   # For Backend
   cd backend && npm run dev
   ```

3. **Commit and push**
   ```bash
   ./commit-and-push.sh "Add feature X"
   ```

4. **Verify on GitHub**
   - Visit: https://github.com/tyerekimea/trail_map
   - Check latest commit

---

## 🌐 GitHub Repository

### **View Your Code:**
https://github.com/tyerekimea/trail_map

### **Clone on Another Machine:**
```bash
git clone https://github.com/tyerekimea/trail_map.git
cd trail_map
```

### **Pull Latest Changes:**
```bash
git pull trail_map main
```

---

## 📋 Quick Reference

### **Daily Commands:**
```bash
# Check status
git status

# Commit and push (automated)
./commit-and-push.sh "Your message"

# View history
git log --oneline -5

# Pull updates
git pull trail_map main
```

### **File Locations:**
- **Script**: `./commit-and-push.sh`
- **This Guide**: `./GIT_WORKFLOW.md`
- **Git Config**: `.git/config`
- **Ignore Rules**: `.gitignore`

---

## 🎉 Summary

✅ **Repository**: Connected to trail_map  
✅ **Script**: Automated commit/push ready  
✅ **Security**: .env files excluded  
✅ **Workflow**: Simple one-command commits  

**Going forward, just run:**
```bash
./commit-and-push.sh "Describe your changes"
```

**That's it! Your code will be automatically committed and pushed to GitHub! 🚀**

---

## 📞 Need Help?

- **Git Documentation**: https://git-scm.com/doc
- **GitHub Guides**: https://guides.github.com
- **This Project**: https://github.com/tyerekimea/trail_map

---

**Happy Coding! 🎨**
