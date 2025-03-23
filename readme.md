# Pulumi Backend Management Tool

A CLI tool for managing Pulumi stacks across different backends, focusing on Cloud and S3.

## Features

- **Complete Backend Management**: Supports all backend operations:
  - **Migration**: Bidirectional transfers between Pulumi Cloud and S3
  - **Initialization**: New project setup with S3 backend configured
  - **Self-Update**: Easy tool updates via Git
  
- **Comprehensive Infrastructure**: Full support for AWS resources:
  - **S3**: Secure bucket creation with versioning and encryption
  - **DynamoDB**: State locking tables with point-in-time recovery
  - **KMS**: Encryption key management for secrets
  
- **Secrets Management**: Robust handling of secrets across backends:
  - **KMS**: AWS Key Management Service integration
  - **Passphrase**: Simple password-based encryption
  - **Service**: Pulumi Cloud hosted encryption
  - **Default**: Local encryption
  
- **Professional UX**: Rich console experience:
  - **Interactive UI**: Progress indicators and clear feedback
  - **Smart Defaults**: Intelligent suggestions based on project context
  - **Verification**: Built-in checks to ensure successful operations

## Installation

### One-Line Install

```bash
curl -fsSL https://raw.githubusercontent.com/jiraguha/pulumi-backend/main/install.sh | bash
```

### Installation Options

Install a specific version:

```bash
# Install from a specific branch
curl -fsSL https://raw.githubusercontent.com/jiraguha/pulumi-backend/main/install.sh | bash -s -- --branch dev

# Install a specific tagged version
curl -fsSL https://raw.githubusercontent.com/jiraguha/pulumi-backend/main/install.sh | bash -s -- --tag v1.0.0
```

Install to a different directory:

```bash
curl -fsSL https://raw.githubusercontent.com/jiraguha/pulumi-backend/main/install.sh | bash -s -- --dir ~/.local/bin
```

## Basic Usage

### Migrate from Pulumi Cloud to S3

```bash
pulumi-backend cloudToS3 --stack=mystack --bucket=my-pulumi-state --region=us-west-2
```

### Migrate from S3 to Pulumi Cloud

```bash
pulumi-backend s3ToCloud --stack=mystack --backend=s3://my-pulumi-state?region=us-west-2
```

### Initialize a New Project with S3 Backend

```bash
pulumi-backend init --name=my-project --bucket=my-pulumi-state
```

### Update the Tool

```bash
pulumi-backend self-update
```

## Advanced Usage

### Cloud to S3 with DynamoDB State Locking

```bash
pulumi-backend cloudToS3 \
  --stack=mystack \
  --bucket=my-pulumi-state \
  --region=us-west-2 \
  --dynamodb-table=pulumi-state-lock \
  --create-dynamodb
```

### Cloud to S3 with KMS Encryption

```bash
pulumi-backend cloudToS3 \
  --stack=mystack \
  --bucket=my-pulumi-state \
  --secrets-provider=awskms \
  --kms-alias=alias/pulumi-secrets
```

### S3 to Cloud with Organization and Default Secrets Provider

```bash
pulumi-backend s3ToCloud \
  --stack=mystack \
  --backend=s3://my-pulumi-state?region=us-west-2 \
  --organization=my-org \
  --secrets-provider=default
```

### Initialize with Interactive Prompts

```bash
pulumi-backend init
```

## Options Reference

### Migration Common Options

| Option | Description |
|--------|-------------|
| `--stack` | Stack name to migrate (required) |
| `--workspace` | Path to Pulumi project (default: current directory) |
| `--delete-source` | Delete the source stack after successful migration |
| `--skip-verify` | Skip verification step |
| `--verbose` | Enable verbose output |
| `--quiet` | Minimal output, only errors |
| `--yes` | Answer yes to all prompts |
| `--no-color` | Disable colored output |

### Cloud to S3 Options

| Option | Description |
|--------|-------------|
| `--bucket` | S3 bucket name for backend storage (required) |
| `--region` | AWS region for resources (default: from AWS_REGION) |
| `--dynamodb-table` | DynamoDB table name for state locking |
| `--create-bucket` | Create S3 bucket if it doesn't exist (default: true) |
| `--create-dynamodb` | Create DynamoDB table if it doesn't exist (default: false) |
| `--secrets-provider` | Secrets provider: 'passphrase', 'awskms', 'default' |
| `--passphrase` | Passphrase for secrets encryption |
| `--kms-alias` | KMS key alias for secrets (default: alias/pulumi-secrets) |

### S3 to Cloud Options

| Option | Description |
|--------|-------------|
| `--backend` | S3 backend URL (e.g., s3://my-bucket?region=us-west-2) (required) |
| `--organization` | Pulumi Cloud organization (optional) |
| `--access-token` | Pulumi access token (uses stored credentials if not specified) |
| `--secrets-provider` | Target secrets provider: 'service' (default), 'passphrase', 'awskms', 'default' |
| `--passphrase` | Source passphrase for decrypting secrets |
| `--kms-key` | Source KMS key for decrypting secrets |

### Initialize Options

| Option | Description |
|--------|-------------|
| `--name` | Project name (default: current directory name) |
| `--description` | Project description |
| `--template` | Pulumi template (default: typescript) |
| `--stack` | Initial stack name (default: dev) |
| `--bucket` | S3 bucket name (default: derived from project name) |
| `--secrets-provider` | Secrets provider type (default: awskms) |

## Requirements

- [Deno](https://deno.land) runtime
- [Pulumi CLI](https://www.pulumi.com/docs/install/)
- [AWS CLI](https://aws.amazon.com/cli/) configured with appropriate permissions
- [Git](https://git-scm.com/) for installations and updates

## Repository Structure

The tool consists of these key files:

```
pulumi-backend/
├── pulumi-backend.ts       # Main CLI interface
├── pulumi-cloud-to-s3.ts   # Cloud to S3 migration
├── pulumi-s3-to-cloud.ts   # S3 to Cloud migration
├── pulumi-init.ts          # Project initialization
└── install.sh              # One-line installer
```

## License

MIT
