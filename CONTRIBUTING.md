# Contributing

Thanks for considering a contribution. This is a small, self-hosted single-user project — keep that in mind when proposing changes.

## Getting started

1. Fork and clone the repo.
2. Follow the Quickstart in [README.md](README.md) to get the app running locally (Docker Compose is the fastest path).
3. Make your change on a feature branch.

## Before opening a PR

- **Backend:** run `node -c <file>` on anything you touched, or at minimum start the server and exercise the affected route.
- **Frontend:** run `npm run lint` and `npm run build` inside `client/`; both must pass clean.
- Keep diffs focused — one logical change per PR is much easier to review than a mixed bag.
- Don't add signup/login, billing, multi-user, or hosted-deployment-specific features back in. This project intentionally stays single-user and self-hosted; if you need those, you're building a different product.
- Never commit real credentials, `.env` files, or personal data. Use `.env.example` to document new configuration.

## Reporting bugs

Open an issue with: what you expected, what happened instead, and enough detail to reproduce it (Node version, whether you're on Docker Compose or local dev, relevant logs).

## License

By contributing, you agree your changes are licensed under this project's [MIT License](LICENSE).
