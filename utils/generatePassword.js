exports.generateStrongPassword = function (length = 12) {
  const uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const lowercase = "abcdefghijklmnopqrstuvwxyz";
  const numbers = "0123456789";
  const symbols = "@$!%*?&";

  const allChars = uppercase + lowercase + numbers + symbols;

  // لازم يكون على الأقل واحد من كل نوع
  const randomUpper = uppercase[Math.floor(Math.random() * uppercase.length)];
  const randomLower = lowercase[Math.floor(Math.random() * lowercase.length)];
  const randomNumber = numbers[Math.floor(Math.random() * numbers.length)];
  const randomSymbol = symbols[Math.floor(Math.random() * symbols.length)];

  let password = randomUpper + randomLower + randomNumber + randomSymbol;

  for (let i = 4; i < length; i++) {
    password += allChars[Math.floor(Math.random() * allChars.length)];
  }

  // Shuffle to make it more random
  return password
    .split("")
    .sort(() => Math.random() - 0.5)
    .join("");
};
