exports.generateStrongPassword = function () {
  const uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const lowercase = "abcdefghijklmnopqrstuvwxyz";
  const numbers = "0123456789";
  const symbols = "@$!%*?&";

  // اختيار حرف عشوائي من كل مجموعة
  const randomUpper = uppercase[Math.floor(Math.random() * uppercase.length)];
  const randomLower = lowercase[Math.floor(Math.random() * lowercase.length)];
  const randomNumber = numbers[Math.floor(Math.random() * numbers.length)];
  const randomSymbol = symbols[Math.floor(Math.random() * symbols.length)];

  // باقي الأحرف يتم اختيارها عشوائياً
  const allChars = uppercase + lowercase + numbers + symbols;
  let password = randomUpper + randomLower + randomNumber + randomSymbol;

  for (let i = 4; i < 12; i++) {
    password += allChars[Math.floor(Math.random() * allChars.length)];
  }

  return password
    .split("")
    .sort(() => 0.5 - Math.random())
    .join("");
};
