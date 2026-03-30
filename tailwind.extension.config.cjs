/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './extension/popup.html',
    './extension/popup.js',
    './extension-firefox/popup.html',
    './extension-firefox/popup.js'
  ],
  theme: {
    extend: {}
  },
  plugins: []
};
