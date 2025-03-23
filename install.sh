#!/usr/bin/env bash

# Pulumi Backend Management Tool Installer
# 
# This script installs the Pulumi Backend Management Tool, which allows
# managing Pulumi stacks across different backends (Cloud and S3).
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/jiraguha/pulumi-backend/main/install.sh | bash
#
# Or with specific options:
#   curl -fsSL https://raw.githubusercontent.com/jiraguha/pulumi-backend/main/install.sh | bash -s -- --dir ~/.local/bin --tag v1.0.0

# Set colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Set default values
INSTALL_DIR="/usr/local/bin"
REPO_URL="https://github.com/jiraguha/pulumi-backend.git"
GIT_REF="main"
REPO_DIR="$HOME/.pulumi-backend"

# Process arguments
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --dir) INSTALL_DIR="$2"; shift ;;
        --repo) REPO_URL="$2"; shift ;;
        --branch) GIT_REF="$2"; shift ;;
        --tag) GIT_REF="$2"; shift ;;
        --ref) GIT_REF="$2"; shift ;;
        --help) 
            echo -e "${BOLD}Pulumi Backend Management Tool Installer${NC}"
            echo ""
            echo "Options:"
            echo "  --dir DIR          Install binaries to DIR (default: /usr/local/bin)"
            echo "  --repo URL         Git repository URL (default: $REPO_URL)"
            echo "  --branch BRANCH    Use specific branch (default: main)"
            echo "  --tag TAG          Use specific tag"
            echo "  --ref REF          Use specific Git reference"
            echo "  --help             Show this help message"
            exit 0
            ;;
        *) echo "Unknown parameter: $1"; exit 1 ;;
    esac
    shift
done

# Check if the installation directory exists and is in PATH
if [[ ! -d "$INSTALL_DIR" ]]; then
    echo -e "${YELLOW}Warning: Installation directory $INSTALL_DIR does not exist.${NC}"
    read -p "Create it? [Y/n] " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]] || [[ -z $REPLY ]]; then
        mkdir -p "$INSTALL_DIR" || { echo -e "${RED}Failed to create directory $INSTALL_DIR${NC}"; exit 1; }
        echo -e "${GREEN}Created directory $INSTALL_DIR${NC}"
    else
        echo -e "${RED}Installation aborted.${NC}"
        exit 1
    fi
fi

if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
    echo -e "${YELLOW}Warning: Installation directory $INSTALL_DIR is not in your PATH.${NC}"
    echo "You may need to add it to your PATH manually or specify a different directory with --dir."
fi

# Function to check if a command exists
check_command() {
    if ! command -v "$1" &> /dev/null; then
        echo -e "${RED}Error: $1 is not installed.${NC}"
        case "$1" in
            git)
                echo -e "Please install Git: ${BLUE}https://git-scm.com/downloads${NC}"
                ;;
            deno)
                echo -e "Please install Deno: ${BLUE}https://deno.land/#installation${NC}"
                ;;
            pulumi)
                echo -e "Please install Pulumi CLI: ${BLUE}https://www.pulumi.com/docs/install/${NC}"
                ;;
            aws)
                echo -e "Please install AWS CLI: ${BLUE}https://aws.amazon.com/cli/${NC}"
                ;;
        esac
        return 1
    fi
    return 0
}

# Banner
echo -e "${BOLD}${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${BLUE}║ ${CYAN}Pulumi Backend Management Tool Installer${BLUE}                   ║${NC}"
echo -e "${BOLD}${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo

# Check prerequisites
echo -e "${BOLD}Checking prerequisites...${NC}"
PREREQS_OK=true

# Check for Git
echo -n "Checking for Git: "
if check_command git; then
    GIT_VERSION=$(git --version)
    echo -e "${GREEN}✓${NC} $GIT_VERSION"
else
    PREREQS_OK=false
fi

# Check for Deno
echo -n "Checking for Deno: "
if check_command deno; then
    DENO_VERSION=$(deno --version | head -n 1)
    echo -e "${GREEN}✓${NC} $DENO_VERSION"
else
    PREREQS_OK=false
fi

# Check for Pulumi CLI
echo -n "Checking for Pulumi CLI: "
if check_command pulumi; then
    PULUMI_VERSION=$(pulumi version)
    echo -e "${GREEN}✓${NC} $PULUMI_VERSION"
else
    PREREQS_OK=false
fi

# Check for AWS CLI
echo -n "Checking for AWS CLI: "
if check_command aws; then
    AWS_VERSION=$(aws --version)
    echo -e "${GREEN}✓${NC} $AWS_VERSION"
else
    PREREQS_OK=false
fi

if [[ "$PREREQS_OK" != "true" ]]; then
    echo -e "\n${RED}Please install missing prerequisites before continuing.${NC}"
    exit 1
fi

# Clone the repository
echo -e "\n${BOLD}Cloning repository...${NC}"
echo -n "Cloning $REPO_URL (ref: $GIT_REF) to $REPO_DIR: "

# Prepare repository directory
if [[ -d "$REPO_DIR" ]]; then
    if [[ -d "$REPO_DIR/.git" ]]; then
        # Directory exists and is a git repo, try to update it
        echo -e "\n${YELLOW}Repository already exists, updating...${NC}"
        (cd "$REPO_DIR" && git fetch && git checkout "$GIT_REF" && git pull) || { 
            echo -e "${RED}Failed to update existing repository${NC}"; 
            exit 1; 
        }
        echo -e "${GREEN}✓${NC} Repository updated successfully"
    else
        # Directory exists but is not a git repo
        echo -e "\n${RED}Directory $REPO_DIR exists but is not a git repository.${NC}"
        read -p "Remove and clone repository? [Y/n] " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]] || [[ -z $REPLY ]]; then
            rm -rf "$REPO_DIR"
            mkdir -p "$REPO_DIR"
        else
            echo -e "${RED}Installation aborted.${NC}"
            exit 1
        fi
    fi
else
    # Directory doesn't exist, create it
    mkdir -p "$REPO_DIR"
fi

# Clone or update the repository
if [[ ! -d "$REPO_DIR/.git" ]]; then
    if git clone --depth 1 --branch "$GIT_REF" "$REPO_URL" "$REPO_DIR"; then
        echo -e "${GREEN}✓${NC} Repository cloned successfully"
    else
        # If branch/tag clone fails, try as a reference
        echo -e "\n${YELLOW}Branch/tag not found, trying as reference...${NC}"
        if git clone "$REPO_URL" "$REPO_DIR" && (cd "$REPO_DIR" && git checkout "$GIT_REF"); then
            echo -e "${GREEN}✓${NC} Repository cloned and reference checked out successfully"
        else
            echo -e "${RED}Failed to clone repository${NC}"
            exit 1
        fi
    fi
fi

# Validate repository structure
echo -e "\n${BOLD}Validating repository...${NC}"
REQUIRED_FILES=(
    "pulumi-backend.ts"
    "pulumi-cloud-to-s3.ts"
    "pulumi-s3-to-cloud.ts"
    "pulumi-init.ts"
)

for file in "${REQUIRED_FILES[@]}"; do
    if [[ ! -f "$REPO_DIR/$file" ]]; then
        echo -e "${RED}Error: Required file $file not found in repository${NC}"
        exit 1
    fi
done

echo -e "${GREEN}✓${NC} Repository structure valid"

# Install scripts
echo -e "\n${BOLD}Installing scripts...${NC}"

# Make scripts executable
chmod +x "$REPO_DIR"/*.ts || { 
    echo -e "${RED}Failed to set executable permissions${NC}"; 
    exit 1; 
}

# Install each script
INSTALL_OK=true
for file in "${REQUIRED_FILES[@]}"; do
    echo -n "Installing $file to $INSTALL_DIR: "
    if cp "$REPO_DIR/$file" "$INSTALL_DIR/"; then
        echo -e "${GREEN}✓${NC}"
    else
        echo -e "${RED}Failed${NC}"
        INSTALL_OK=false
        break
    fi
done

# Create symlink to main script without .ts extension
echo -n "Creating symlink pulumi-backend: "
if ln -sf "$INSTALL_DIR/pulumi-backend.ts" "$INSTALL_DIR/pulumi-backend"; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}Failed${NC}"
    INSTALL_OK=false
fi

# Print completion and instructions
if [[ "$INSTALL_OK" == "true" ]]; then
    echo -e "\n${GREEN}${BOLD}Installation successful!${NC}"
    echo -e "\n${BOLD}Repository location:${NC} $REPO_DIR"
    echo -e "To update in the future, run:"
    echo -e "  ${CYAN}pulumi-backend self-update${NC}"
    
    echo -e "\n${BOLD}Usage:${NC}"
    echo -e "  ${CYAN}pulumi-backend cloudToS3${NC} --stack=mystack --bucket=my-pulumi-state [options]"
    echo -e "  ${CYAN}pulumi-backend s3ToCloud${NC} --stack=mystack --backend=s3://my-bucket?region=us-west-2 [options]"
    echo -e "  ${CYAN}pulumi-backend init${NC} --name=my-project --bucket=my-pulumi-state [options]"
    echo -e "\n${BOLD}For help:${NC}"
    echo -e "  ${CYAN}pulumi-backend help${NC}"
    
    if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
        echo -e "\n${YELLOW}Note: Add $INSTALL_DIR to your PATH to use pulumi-backend directly.${NC}"
        echo -e "For example, add this to your ~/.bashrc or ~/.zshrc:"
        echo -e "  ${CYAN}export PATH=\"\$PATH:$INSTALL_DIR\"${NC}"
    fi
    
    echo -e "\n${BOLD}Installed version:${NC} $GIT_REF"
else
    echo -e "\n${RED}Installation failed.${NC}"
    echo "You may need sudo privileges to install to $INSTALL_DIR."
    echo "Try running with sudo or specify a different directory with --dir:"
    echo "curl -fsSL https://raw.githubusercontent.com/jiraguha/pulumi-backend/main/install.sh | bash -s -- --dir ~/.local/bin"
    exit 1
fi
