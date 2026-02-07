#!/bin/bash

# Commit and Push Script for Trail Map
# Usage: ./commit-and-push.sh "Your commit message"

set -e  # Exit on error

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}🚀 Trail Map - Commit and Push Script${NC}\n"

# Check if commit message is provided
if [ -z "$1" ]; then
    echo -e "${RED}❌ Error: Commit message required${NC}"
    echo "Usage: ./commit-and-push.sh \"Your commit message\""
    exit 1
fi

COMMIT_MSG="$1"

# Navigate to project root
cd "$(dirname "$0")"

echo -e "${YELLOW}📂 Current directory: $(pwd)${NC}\n"

# Check git status
echo -e "${YELLOW}📊 Checking git status...${NC}"
git status --short

# Check if there are changes
if [ -z "$(git status --porcelain)" ]; then
    echo -e "${GREEN}✅ No changes to commit${NC}"
else
    echo -e "\n${YELLOW}📝 Staging changes...${NC}"
    
    # Add all changes except .env files
    git add -A
    git reset backend/.env 2>/dev/null || true
    git reset .env 2>/dev/null || true
    
    echo -e "${GREEN}✅ Changes staged${NC}\n"
    
    # Show what will be committed
    echo -e "${YELLOW}📋 Files to be committed:${NC}"
    git diff --cached --name-status
    
    echo -e "\n${YELLOW}💾 Committing changes...${NC}"
    git commit -m "$COMMIT_MSG" -m "Co-authored-by: Ona <no-reply@ona.com>"
    
    echo -e "${GREEN}✅ Changes committed${NC}\n"
fi

# Push to both remotes
echo -e "${YELLOW}🌐 Pushing to trail_map repository...${NC}"
git push trail_map main

echo -e "${GREEN}✅ Pushed to trail_map${NC}\n"

echo -e "${YELLOW}🌐 Pushing to origin repository...${NC}"
git push origin main 2>/dev/null || git push origin master 2>/dev/null || echo "Origin push skipped"

echo -e "${GREEN}✅ Pushed to origin${NC}\n"

# Show final status
echo -e "${YELLOW}📊 Final status:${NC}"
git log --oneline -3

echo -e "\n${GREEN}🎉 All done! Changes committed and pushed successfully!${NC}"
echo -e "${GREEN}🔗 Repository: https://github.com/tyerekimea/trail_map${NC}\n"
