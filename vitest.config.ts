export default {
  root: "tools/clod-poc",
  test: {
    setupFiles: ["./src/test-setup.ts"],
    testTimeout: 120000,
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/reference/**",
      "**/.{idea,git,cache,output,temp}/**",
    ],
  },
};
