---
trigger: always_on
---

When you have to do browser testing of the app and have to log in, use the email address of jkfussell@gmail.com and the password of scooby.

The port number of the web server for testing should always be 3000.

## Testing Requirements

After making any code changes:
1. Run `npm run test:run` to ensure all unit and component tests pass
2. If you modify a function or component that has tests, update the corresponding test file
3. For new features, create tests in the appropriate `__tests__` directory following existing patterns
4. If tests fail, fix them before considering the task complete
5. For changes affecting login, authentication, or critical user flows, also run `npm run test:e2e`

See the `/testing` workflow for detailed instructions.