module.exports = {
  // Restores all mock / spied-on implementations before each test
  restoreMocks: true,

  // Directories to look for tests in
  roots: ['src'],
  testEnvironment: "node",
  transformIgnorePatterns: [
    "node_modules/(?!(axios)/)" // Add other packages here as needed
  ],
  transform: {
    "^.+\\.(js|jsx|ts|tsx)$": "babel-jest"
  },
};
