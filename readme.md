# Pulumi Backend Management Tool

A CLI tool for managing Pulumi stacks across backends, supporting migrations between Pulumi Cloud and Amazon S3, project initialization, and secrets management.

## Features

### Backend Management
- **Migration**: Transfer Pulumi stacks between Pulumi Cloud and S3 backends in either direction.
- **Initialization**: Set up new projects with S3 backend, KMS encryption, and bucket provisioning.
- **Auto Login**: Log into S3 backends with interactive bucket/region selection via `s3Login`.
- **Self-Update**: Keep the tool current via Git.

### Infrastructure Support
- **S3**: Bucket creation with versioning, encryption, and lifecycle policies.
- **KMS**: Encryption key and alias management for secrets.
- **Secrets**: Support for AWS KMS, passphrase, service (Pulumi Cloud), and default providers.

### Developer Experience
- Interactive prompts with smart defaults derived from project context.
- Spinner-based progress indicators and structured logging.
- Built-in migration verification via `pulumi preview`.

## Installation

### One-Line Install

```bash
curl -fsSL https://raw.githubusercontent.com/jiraguha/pulumi-backend/main/install.sh | bash
```

### Options

```bash
# Install a specific tag
curl -fsSL https://raw.githubusercontent.com/jiraguha/pulumi-backend/main/install.sh | bash -s -- --tag v1.0.0

# Install a specific branch
curl -fsSL https://raw.githubusercontent.com/jiraguha/pulumi-backend/main/install.sh | bash -s -- --branch dev

# Install to a different directory
curl -fsSL https://raw.githubusercontent.com/jiraguha/pulumi-backend/main/install.sh | bash -s -- --dir ~/.local/bin
```

## Usage

### Migrate from Pulumi Cloud to S3

```bash
pulumi-backend cloudToS3 --stack=mystack --bucket=my-pulumi-state --region=us-west-2
```

### Migrate from S3 to Pulumi Cloud

```bash
pulumi-backend s3ToCloud --stack=mystack --organization=my-org --backend=s3://my-pulumi-state?region=us-west-2
```

### Initialize a new project with S3 backend

```bash
pulumi-backend init --name=my-project --bucket=my-pulumi-state
```

### Auto login to S3 backend

```bash
pulumi-backend s3Login
```

### Update the tool

```bash
pulumi-backend self-update
```

### Get command-specific help

```bash
pulumi-backend <command> --help
```

## Advanced Usage

### Cloud to S3 with KMS encryption

```bash
pulumi-backend cloudToS3 \
  --stack=mystack \
  --bucket=my-pulumi-state \
  --secrets-provider=awskms \
  --kms-alias=alias/pulumi-secrets
```

### S3 to Cloud with organization

```bash
pulumi-backend s3ToCloud \
  --stack=mystack \
  --backend=s3://my-pulumi-state?region=us-west-2 \
  --organization=my-org
```

### Non-interactive initialization

```bash
pulumi-backend init \
  --name=my-project \
  --bucket=my-pulumi-state \
  --region=us-west-2 \
  --secrets-provider=awskms \
  --no-interactive --yes
```

### Interactive initialization

```bash
pulumi-backend init
```

## Requirements

- [Deno](https://deno.land) runtime
- [Pulumi CLI](https://www.pulumi.com/docs/install/)
- [AWS CLI](https://aws.amazon.com/cli/) configured with appropriate permissions
- [Git](https://git-scm.com/) for installation and updates

## Project Structure

```
pulumi-backend/
├── mod.ts                    # Entry point (shebang)
├── pulumi-backend.sh         # Shell wrapper (symlink target)
├── deno.json                 # Import map and tasks
├── src/
│   ├── cli.ts                # Command routing and help
│   ├── version.ts            # Version constant
│   ├── types.ts              # Shared interfaces
│   ├── ui/
│   │   ├── logger.ts         # Logger class with spinners
│   │   ├── symbols.ts        # UI symbols
│   │   ├── banner.ts         # CLI banner
│   │   └── colors.ts         # Color re-exports
│   ├── exec/
│   │   └── command.ts        # Command execution (Deno.Command)
│   ├── checks/
│   │   └── prerequisites.ts  # Pulumi/AWS prerequisite checks
│   ├── aws/
│   │   ├── s3.ts             # S3 bucket operations
│   │   ├── kms.ts            # KMS key management
│   │   └── identity.ts       # AWS identity
│   ├── pulumi/
│   │   ├── backend.ts        # Backend login (S3/Cloud)
│   │   ├── stack.ts          # Stack operations
│   │   ├── secrets.ts        # Secrets provider management
│   │   └── project.ts        # Project init and config
│   └── commands/
│       ├── cloud-to-s3.ts    # Cloud to S3 migration
│       ├── s3-to-cloud.ts    # S3 to Cloud migration
│       ├── init.ts           # Project initialization
│       ├── s3-login.ts       # S3 auto-login
│       └── self-update.ts    # Self-update
├── install.sh                # Installer script
└── dummy-test-infra/         # Test infrastructure
```

## License

Licensed under the [MIT License](LICENSE).

## Contributing

Contributions welcome. Open issues and pull requests on [GitHub](https://github.com/jiraguha/pulumi-backend).
