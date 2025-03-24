# Pulumi Backend Management Tool

Elevate your Pulumi experience with our sleek and intuitive CLI tool for managing stacks across various backends, focusing on both Pulumi Cloud and Amazon S3. Designed for professionals who demand precision and efficiency, this tool offers seamless migrations, comprehensive infrastructure management, and robust secrets handling—all wrapped in a user-friendly interface.

## ✨ Features

### **🔄 Complete Backend Management**
- **Migration Made Simple**: Effortlessly transfer your Pulumi stacks between Pulumi Cloud and S3 backends.
- **Initialization**: Quickly set up new projects with your preferred backend configurations.
- **Self-Update**: Keep your tool up-to-date with the latest features and improvements via Git.
- **Auto Login**: Seamlessly log into your S3 backend using the new `s3Login` command for streamlined workflows.

### **🛠 Comprehensive Infrastructure Support**
- **AWS Integration**:
  - **S3**: Secure bucket creation with versioning and encryption.
  - **DynamoDB**: Manage state locking tables with point-in-time recovery.
  - **KMS**: Handle encryption key management seamlessly.
- **Secrets Management**:
  - **KMS**: Integrate with AWS Key Management Service for robust security.
  - **Passphrase**: Utilize simple password-based encryption.
  - **Service**: Leverage Pulumi Cloud hosted encryption options.
  - **Default**: Rely on local encryption for straightforward setups.

### **🌟 Professional UX**
- **Interactive UI**: Engage with progress indicators and clear, actionable feedback.
- **Smart Defaults**: Benefit from intelligent suggestions tailored to your project context.
- **Verification**: Utilize built-in checks to ensure successful and accurate operations.

## 🚀 Installation

### **🔥 One-Line Install**

Quickly install the Pulumi Backend Management Tool using the following command:

```bash
curl -fsSL https://raw.githubusercontent.com/jiraguha/pulumi-backend/main/install.sh | bash
```

### **🔧 Installation Options**

Specify installation parameters to customize your setup:

- **Install a Specific Version**:

  ```bash
  # Install from a specific branch
  curl -fsSL https://raw.githubusercontent.com/jiraguha/pulumi-backend/main/install.sh | bash -s -- --branch dev

  # Install a specific tagged version
  curl -fsSL https://raw.githubusercontent.com/jiraguha/pulumi-backend/main/install.sh | bash -s -- --tag v1.0.0
  ```

- **Install to a Different Directory**:

  ```bash
  curl -fsSL https://raw.githubusercontent.com/jiraguha/pulumi-backend/main/install.sh | bash -s -- --dir ~/.local/bin
  ```

## 🎯 Basic Usage

### **🔄 Migrate from Pulumi Cloud to S3**

Seamlessly transfer your stack from Pulumi Cloud to an S3 backend:

```bash
pulumi-backend cloudToS3 --stack=mystack --bucket=my-pulumi-state --region=us-west-2
```

### **🔄 Migrate from S3 to Pulumi Cloud**

Easily switch your stack from an S3 backend back to Pulumi Cloud:

```bash
pulumi-backend s3ToCloud --stack=mystack --backend=s3://my-pulumi-state?region=us-west-2
```

### **🆕 Initialize a New Project with S3 Backend**

Kickstart a new Pulumi project with S3 as your backend:

```bash
pulumi-backend init --name=my-project --bucket=my-pulumi-state
```

### **🔄 Update the Tool**

Keep your Pulumi Backend Management Tool up-to-date:

```bash
pulumi-backend self-update
```

### **🔐 Auto Login to S3 Backend**

Automatically log into your S3 backend for streamlined operations:

```bash
pulumi-backend s3Login --bucket=my-pulumi-state --region=us-west-2
```

## 🛠 Advanced Usage

### **🔄 Cloud to S3 with DynamoDB State Locking**

Enhance your migration with DynamoDB state locking for improved consistency:

```bash
pulumi-backend cloudToS3 \
  --stack=mystack \
  --bucket=my-pulumi-state \
  --region=us-west-2 
```

### **🔄 Cloud to S3 with KMS Encryption**

Secure your secrets during migration using AWS KMS:

```bash
pulumi-backend cloudToS3 \
  --stack=mystack \
  --bucket=my-pulumi-state \
  --secrets-provider=awskms \
  --kms-alias=alias/pulumi-secrets
```

### **🔄 S3 to Cloud with Organization and Default Secrets Provider**

Migrate with organizational context and default secrets handling:

```bash
pulumi-backend s3ToCloud \
  --stack=mystack \
  --backend=s3://my-pulumi-state?region=us-west-2 \
  --organization=my-org \
  --secrets-provider=default
```

### **🆕 Initialize with Interactive Prompts**

Start a new project and configure settings interactively:

```bash
pulumi-backend init
```

### **🔐 Auto Login to S3 Backend**

Streamline your workflow by automatically logging into your S3 backend:

```bash
pulumi-backend s3Login
```

## 📝 Options Reference

### **🔄 Migration Common Options**

| Option           | Description                                     |
|------------------|-------------------------------------------------|
| `--stack`        | **Stack name to migrate** (required)            |
| `--workspace`    | Path to Pulumi project (default: current directory) |
| `--delete-source`| Delete the source stack after successful migration |
| `--skip-verify`  | Skip verification step                          |
| `--verbose`      | Enable verbose output                           |
| `--quiet`        | Minimal output, only errors                     |
| `--yes`          | Answer yes to all prompts                       |
| `--no-color`     | Disable colored output                          |

### **🔄 Cloud to S3 Options**

| Option               | Description                                           |
|----------------------|-------------------------------------------------------|
| `--bucket`           | **S3 bucket name for backend storage** (optional)    |
| `--region`           | AWS region for resources (default: from AWS_REGION)    |
| `--create-bucket`    | Create S3 bucket if it doesn't exist (default: true)  |
| `--secrets-provider` | Secrets provider: 'passphrase', 'awskms', 'default'   |
| `--passphrase`       | Passphrase for secrets encryption                    |
| `--kms-alias`        | KMS key alias for secrets (default: alias/pulumi-secrets) |

### **🔄 S3 to Cloud Options**

| Option               | Description                                                      |
|----------------------|------------------------------------------------------------------|
| `--backend`          | **S3 backend URL** (e.g., s3://my-bucket?region=us-west-2) (optional) |
| `--organization`     | Pulumi Cloud organization (optional)                            |
| `--access-token`     | Pulumi access token (uses stored credentials if not specified)   |
| `--secrets-provider` | Target secrets provider: 'service' (default), 'passphrase', 'awskms', 'default' |
| `--passphrase`       | Source passphrase for decrypting secrets                        |
| `--kms-key`          | Source KMS key for decrypting secrets                           |

### **🆕 Initialize Options**

| Option              | Description                                         |
|---------------------|-----------------------------------------------------|
| `--name`            | Project name (default: current directory name)      |
| `--description`     | Project description                                 |
| `--template`        | Pulumi template (default: typescript)               |
| `--stack`           | Initial stack name (default: dev)                   |
| `--bucket`          | S3 bucket name (default: derived from project name) |
| `--secrets-provider`| Secrets provider type (default: awskms)             |


## 📋 Requirements

- [Deno](https://deno.land) runtime
- [Pulumi CLI](https://www.pulumi.com/docs/install/)
- [AWS CLI](https://aws.amazon.com/cli/) configured with appropriate permissions
- [Git](https://git-scm.com/) for installations and updates

## 📂 Repository Structure

Organized for clarity and efficiency, the tool's repository includes:

```
pulumi-backend/
├── pulumi-backend.ts       # Main CLI interface
├── pulumi-cloud-to-s3.ts   # Cloud to S3 migration
├── pulumi-s3-to-cloud.ts   # S3 to Cloud migration
├── pulumi-s3-login.ts      # S3 backend auto login
├── pulumi-init.ts          # Project initialization
└── install.sh              # One-line installer
```

## 📝 License

Licensed under the [MIT License](LICENSE).

## 🤝 Contributing

We welcome contributions! Please open issues and pull requests on [GitHub](https://github.com/jiraguha/pulumi-backend).


## 🌐 Stay Connected

Follow us on [GitHub](https://github.com/jiraguha/pulumi-backend) to stay updated with the latest developments and features.
