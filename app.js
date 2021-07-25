const express = require("express");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const bcrypt = require("bcrypt");
const path = require("path");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());

let db = null;
const dbPath = path.join(__dirname, "twitterClone.db");

const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server Running at http://localhost:3000/");
    });
  } catch (e) {
    console.log(`DB Error: ${e.message}`);
    process.exit(1);
  }
};

initializeDBAndServer();

const convertUserDBObjectToResponseObject = (DBObject) => {
  return {
    userId: DBObject.user_id,
    name: DBObject.name,
    username: DBObject.username,
    password: DBObject.password,
    gender: DBObject.gender,
  };
};

const convertFollowerDBObjectToResponseObject = (DBObject) => {
  return {
    followerId: DBObject.follower_id,
    followerUserId: DBObject.follower_user_id,
    followingUserId: DBObject.following_user_id,
  };
};

const convertTweetDBObjectToResponseObject = (DBObject) => {
  return {
    tweet: DBObject.tweet,
    likes: DBObject.likes,
    replies: DBObject.replies,
    dateTime: DBObject.dateTime,
  };
};

const replies = (DBObject) => {
  return {
    replies: DBObject,
  };
};

app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const getUserQuery = `
    SELECT * 
    FROM user 
    WHERE username = '${username}';`;
  const dbUser = await db.get(getUserQuery);
  if (dbUser === undefined) {
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const hashedPassword = await bcrypt.hash(password, 10);
      const addUserQuery = `
            INSERT INTO 
            user (username, password, name, gender)
            VALUES ('${username}','${hashedPassword}','${name}','${gender}');`;
      await db.run(addUserQuery);
      response.send("User created successfully");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const getUserQuery = `
    SELECT * 
    FROM user 
    WHERE username = '${username}';`;
  const dbUser = await db.get(getUserQuery);
  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password);
    const payload = { username: username };
    if (isPasswordMatched === true) {
      const jwtToken = jwt.sign(payload, "MY_SECRET_CODE");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

const authentication = async (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "MY_SECRET_CODE", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        next();
      }
    });
  }
};

app.get("/user/tweets/feed/", authentication, async (request, response) => {
  const { username } = request;
  const getUserQuery = `
    SELECT * 
    FROM user 
    WHERE username = '${username}';`;
  const dbUser = await db.get(getUserQuery);
  const getTweetsQuery = `
    SELECT user.username as username,
      tweet.tweet as tweet,
      tweet.date_time as dateTime
    FROM follower 
      INNER JOIN user on follower.following_user_id = user.user_id
      INNER JOIN tweet on user.user_id = tweet.user_id
    WHERE follower.follower_user_id = ${dbUser.user_id}
    ORDER By tweet.date_time desc
    LIMIT 4;`;
  const tweetArray = await db.all(getTweetsQuery);
  response.send(tweetArray);
});

app.get("/user/following/", authentication, async (request, response) => {
  const { username } = request;
  const getUserQuery = `
        SELECT * 
        FROM user 
        WHERE username = '${username}';`;
  const dbUser = await db.get(getUserQuery);
  const getNameQuery = `
    SELECT user.name as name
    FROM follower
      INNER JOIN user on follower.following_user_id = user.user_id
    WHERE follower.follower_user_id = ${dbUser.user_id};`;
  const names = await db.all(getNameQuery);
  response.send(names.map((eachName) => eachName));
});

app.get("/user/followers/", authentication, async (request, response) => {
  const { username } = request;
  const getUserQuery = `
        SELECT * 
        FROM user 
        WHERE username = '${username}';`;
  const dbUser = await db.get(getUserQuery);
  const getNameQuery = `
    SELECT user.name as name
    FROM follower
      INNER JOIN user on follower.follower_user_id = user.user_id
    WHERE follower.following_user_id = ${dbUser.user_id};`;
  const names = await db.all(getNameQuery);
  response.send(names.map((eachName) => eachName));
});

app.get("/tweets/:tweetId/", authentication, async (request, response) => {
  const { username } = request;
  const { tweetId } = request.params;
  const getUserQuery = `
    SELECT * 
    FROM tweet 
      INNER JOIN follower on tweet.user_id = follower.following_user_id
      INNER JOIN user on follower.follower_user_id = user.user_id
    WHERE user.username = '${username}'
      and tweet.tweet_id = ${tweetId};`;
  const dbUser = await db.get(getUserQuery);
  if (dbUser === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    const getStatsQuery = `
        SELECT 
          tweet.tweet as tweet,
          count(like.like_id) as likes,
          count(reply.reply_id) as replies,
          tweet.date_time as dateTime
        FROM tweet 
          INNER JOIN like on tweet.tweet_id = like.tweet_id
          INNER JOIN reply on tweet.tweet_id = reply.tweet_id
        WHERE tweet.tweet_id = ${tweetId}
        GROUP BY tweet.tweet_id;`;
    const tweet = await db.get(getStatsQuery);
    response.send(convertTweetDBObjectToResponseObject(tweet));
  }
});

app.get(
  "/tweets/:tweetId/likes/",
  authentication,
  async (request, response) => {
    const { username } = request;
    const { tweetId } = request.params;
    const getUserQuery = `
    SELECT * 
    FROM tweet 
      INNER JOIN follower on tweet.user_id = follower.following_user_id
      INNER JOIN user on follower.follower_user_id = user.user_id
    WHERE user.username = '${username}'
      and tweet.tweet_id = ${tweetId};`;
    const dbUser = await db.get(getUserQuery);
    if (dbUser === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const getStatsQuery = `
    SELECT user.username 
    FROM like 
      INNER JOIN user on like.user_id = user.user_id
    WHERE like.tweet_id = ${tweetId};`;
      const tweet = await db.all(getStatsQuery);
      const myArray = [];
      tweet.map((eachEle) => myArray.push(eachEle.username));
      response.send({
        likes: myArray,
      });
    }
  }
);

app.get(
  "/tweets/:tweetId/replies/",
  authentication,
  async (request, response) => {
    const { username } = request;
    const { tweetId } = request.params;
    const getUserQuery = `
    SELECT * 
    FROM tweet 
      INNER JOIN follower on tweet.user_id = follower.following_user_id
      INNER JOIN user on follower.follower_user_id = user.user_id
    WHERE user.username = '${username}'
      and tweet.tweet_id = ${tweetId};`;
    const dbUser = await db.get(getUserQuery);
    if (dbUser === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const getStatsQuery = `
      SELECT 
        user.name as name,
        reply.reply as reply
      FROM reply 
        INNER JOIN user on reply.reply_id = user.user_id
      WHERE reply.tweet_id = ${tweetId};`;
      const reply = await db.all(getStatsQuery);
      const getTweetQuery = `
      SELECT * 
      FROM tweet 
      WHERE tweet_id = ${tweetId};`;
      const tweet = await db.get(getTweetQuery);
      const myArray = [];
      reply.map((eachEle) => myArray.push(eachEle));
      response.send({
        replies: myArray,
      });
    }
  }
);

app.get("/user/tweets/", authentication, async (request, response) => {
  const { username } = request;
  const getUserQuery = `
    SELECT * 
    FROM user 
    WHERE username = '${username}';`;
  const dbUser = await db.get(getUserQuery);
  const getStatsQuery = `
    SELECT 
      tweet.tweet as tweet,
      COUNT(like.like_id) as likes,
      COUNT(reply.reply_id) as replies,
      tweet.date_time as dateTime
    FROM tweet
      INNER JOIN like on tweet.tweet_id = like.tweet_id
      INNER JOIN reply on tweet.tweet_id = reply.tweet_id
    WHERE tweet.user_id = ${dbUser.user_id};`;
  const tweetArray = await db.all(getStatsQuery);
  response.send(
    tweetArray.map((eachTweet) =>
      convertTweetDBObjectToResponseObject(eachTweet)
    )
  );
});

app.post("/user/tweets/", authentication, async (request, response) => {
  const { username } = request;
  const { tweet } = request.body;
  const getUserQuery = `
    SELECT * 
    FROM user 
    WHERE username = '${username}';`;
  const dbUser = await db.get(getUserQuery);
  const addTweetQuery = `
    INSERT INTO 
      tweet (tweet)
    VALUES ('${tweet}');`;
  await db.run(addTweetQuery);
  response.send("Created a Tweet");
});

app.delete("/tweets/:tweetId/", authentication, async (request, response) => {
  const { username } = request;
  const { tweetId } = request.params;
  const getUserQuery = `
    SELECT * 
    FROM user 
    WHERE username = '${username}';`;
  const getTweetQuery = `
    SELECT * 
    FROM tweet 
    WHERE tweet_id = ${tweetId};`;
  const user = await db.get(getUserQuery);
  const tweet = await db.get(getTweetQuery);
  if (user.user_id === tweet.user_id) {
    const deleteTweetQuery = `
        DELETE 
        FROM tweet 
        WHERE tweet_id = ${tweetId};`;
    await db.run(deleteTweetQuery);
    response.send("Tweet Removed");
  } else {
    response.status(401);
    response.send("Invalid Request");
  }
});

module.exports = app;
