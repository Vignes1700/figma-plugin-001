const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
  mode: 'production', // or 'development' if you prefer
  entry: {
    code: path.resolve(__dirname, 'src', 'code.ts')
  },
  module: {
    rules: [
      { test: /\.ts$/, use: 'ts-loader' },
      { test: /\.html$/, use: 'html-loader' }
    ]
  },
  resolve: {
    extensions: ['.ts', '.js']
  },
  output: {
    filename: '[name].js',
    path: path.resolve(__dirname, 'dist')
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: path.resolve(__dirname, 'src', 'ui.html'),
      filename: 'ui.html',
      chunks: ['ui'],
      inject: false
    })
  ]
};