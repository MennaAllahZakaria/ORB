const axios = require("axios");
require("dotenv").config({ path: "config.env" });

const testInquiry = async () => {
  const customerReference = "123456789"; // Dummy reference
  try {
    const response = await axios.post(
      "https://back.easykash.net/api/cash-api/inquire",
      { customerReference },
      {
        headers: {
          authorization: process.env.EASYKASH_API_KEY || "DUMMY_KEY",
        },
      }
    );
    console.log("Response:", response.data);
  } catch (err) {
    console.log("Error Status:", err.response?.status);
    console.log("Error Data:", err.response?.data);
  }
};

testInquiry();
