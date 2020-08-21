const express = require('express');
const path = require('path');
const cluster = require('cluster');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');
const numCPUs = require('os').cpus().length;
require('dotenv').config();

// create mongoose client
let mongoose = require('mongoose');
const mongo_uri = process.env.MONGODB_URL;

// connect to mongodb
mongoose.connect(mongo_uri, { useNewUrlParser: true, useUnifiedTopology: true, poolSize: 10 })
let db = mongoose.connection
db.on('error', console.error.bind(console, 'Connection Error:'));
db.once('open', function() {
  console.log("Connected to MongoDB");
});

// restaurant model for mongodb
const RestaurantModel = mongoose.model("restaurant", {
  name: String,
  city: String,
  state: { type: String, enum: ['NY', 'FL', 'TX'] },
  playlist: String,
  playlistUrl: String,
  scent: String,
  lights: { type: String, enum: ['dim', 'normal', 'bright'] },
  items: Array,
  referralUrl: String
});

// listen for the signal interruption (ctrl-c)
process.on('SIGINT', () => {
  mongoose.connection.close();
  process.exit();
});

const isDev = process.env.NODE_ENV !== 'production';
const PORT = process.env.PORT || 5000;

// Multi-process to utilize all CPU cores.
if (!isDev && cluster.isMaster) {
  console.error(`Node cluster master ${process.pid} is running`);

  // Fork workers.
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    console.error(`Node cluster worker ${worker.process.pid} exited: code ${code}, signal ${signal}`);
  });

} else {
  const app = express();

  // Priority serve any static files.
  app.use(express.static(path.resolve(__dirname, '../react-ui/build')));

  // Middleware for CRUD
  var bodyParser = require('body-parser');
  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({ extended: true }));

  app.get('/jwt', (req, res) => {
    let privateKey = process.env.PRIVATE_KEY
    let token = jwt.sign({"body": "stuff"}, privateKey, {algorithm: 'HS256'});
    res.send(token);
  });

  // get all restaurants
  app.get('/api/restaurants', isAuthorized, async (req, res) => {
    try {
      const result = await RestaurantModel.find().exec();
      res.send(result);
    } catch (error) {
      res.status(500).send(error);
    }
  });

  // get a specific restaurant
  app.get('/api/restaurants/:id', isAuthorized, async (req, res) => {
    const mongoId = ObjectId(req.params.id);
    try {
      const restaurant = await RestaurantModel.findById(mongoId).exec();
      res.send(restaurant);
    } catch (error) {
      res.status(500).send(error);
    }
  });

  // add a restaurant
  app.post("/api/restaurants", isAuthorized, async (req, res) => {
    try {
      const restaurant = new RestaurantModel(req.body);
      const result = await restaurant.save();
      res.send(result);
    } catch (error) {
      res.status(500).send(error);
    }
  });

  // update a restaurant
  app.put('/api/restaurants/:id', isAuthorized, async (req, res) => {
    var mongoId = ObjectId(req.params.id);
    try {
      let restaurant = await RestaurantModel.findById(mongoId).exec();
      restaurant.set(req.body);
      const result = await restaurant.save();
      res.send(result);
    } catch (error) {
        res.status(500).send(error);
    }
  });

  // delete a restaurant
  app.delete('/api/restaurants/:id', isAuthorized, async (req, res) => {
    var mongoId = ObjectId(req.params.id);
    try {
      const result = await RestaurantModel.deleteOne({ _id: mongoId }).exec();
      res.send(result);
    } catch (error) {
      res.status(500).send(error);
    }
  });

  // All remaining requests return the React app, so it can handle routing.
  app.get('*', (req, res) => {
    res.sendFile(path.resolve(__dirname, '../react-ui/build', 'index.html'));
  });

  function isAuthorized(req, res, next) {
    if(!isDev) {
      if(typeof req.headers.authorization !== "undefined") {
        let token = req.headers.authorization.split(" ")[1];
        let privateKey = process.env.PRIVATE_KEY

        jwt.verify(token, privateKey, {algorithm: "HS256"}, (err, decoded) => {
            if (err) {
                res.status(500).json({ error: "Not Authorized"});
                throw new Error("Not Authorized");
            }
            return next();
        });
      } else {
        res.status(500).json({error: "Not Authorized"});
        throw new Error("Not Authorized");
      }
    } else {
      next();
    }
  }

  app.listen(PORT, () => {
    console.error(`Node ${isDev ? 'dev server' : 'cluster worker '+process.pid}: listening on port ${PORT}`);
  });
}
