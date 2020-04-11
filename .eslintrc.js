module.exports = {
  root: true,
  parser: "babel-eslint",
  extends: [
    "airbnb-base",
    "plugin:no-unsanitized/DOM",
    "plugin:prettier/recommended",
  ],
  plugins: ["prettier", "no-unsanitized", "promise"],
  parserOptions: {
    sourceType: "module"
  },
  rules: {
    "no-unused-vars": ["error", { "varsIgnorePattern": "_.+" }],
    "no-underscore-dangle": ["off"],
    "no-console": ["off"],
    "radix": ["off"] //fixed in ES5
  },
  env: {
    "mocha": true,
    "node": true
  },
  settings: {
    "import/resolver": {
      node: {
        moduleDirectory: ["node_modules", "src"]
      }
    }
  },
  globals: {
    __PATH_PREFIX__: true
  }
};
