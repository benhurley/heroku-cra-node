const express = require('express');
const path = require('path');
const cluster = require('cluster');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');
const axios = require('axios');
const numCPUs = require('os').cpus().length;
var CronJob = require('cron').CronJob;
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

// restaurant schema and model for mongodb
const restaurantSchema = require('./restaurantSchema.js');
const RestaurantModel = mongoose.model("nyc_restaurant", restaurantSchema);

const nycApiEndpoint = 'https://data.cityofnewyork.us/resource/4dx7-axux.json?$limit=1000';

// Persistence Cron Job
const job = new CronJob('00 00 00 * * *', function() {
	const d = new Date();
  console.log('Midnight:', d);
  persistData();
});
job.start();
console.log('persistence cron job created');

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

  app.get('/api/persist/nyc', async (req, res) => {
    persistData();
  });

  function persistData() {
    console.log('Starting daily persistence');
    var today = new Date()
    today.setDate(today.getDate() - 1)
    today = today.toISOString().split("T")[0];
    const query = `&$where=inspectedon between '${today}T00:00:00' and '${today}T23:59:59'&$order=inspectedon DESC`;
    axios.get(`${nycApiEndpoint}${query}`)
      .then((response) => {       
        console.log('Number of records to persist: ' + response.data.length);
        const ids = response.data.map(restaurant => parseInt(restaurant.restaurantinspectionid));
        db.collection('nyc_restaurants').deleteMany({restaurantinspectionid: {$in: ids}});
        response.data.forEach(restaurant => {
          try {
            const restaurantToBeSaved = new RestaurantModel(restaurant);
            const result = restaurantToBeSaved.save();
            console.log('Persisting restaurant ID: ' + restaurant.restaurantinspectionid);
          } catch(error) {
            console.log('Error persisting restaurant ID: ' + restaurant.restaurantinspectionid + ", error: " + error);
          }
        });
        res.send(response.data);
      })
  }

  // get all restaurants
  app.get('/api/restaurants', async (req, res) => {
    try {
      const result = await RestaurantModel.find().exec();
      res.send(result);
    } catch (error) {
      res.status(500).send(error);
    }
  });

  // get a specific restaurant
  app.get('/api/restaurants/:id', async (req, res) => {
    const mongoId = ObjectId(req.params.id);
    console.log(req.params.id);
    try {
      const restaurant = await RestaurantModel.findById(mongoId).exec();
      res.send(restaurant);
    } catch (error) {
      res.status(500).send(error);
    }
  });

  // add a restaurant
  app.post("/api/restaurants", async (req, res) => {
    try {
      const restaurant = new RestaurantModel(req.body);
      const result = await restaurant.save();
      res.send(result);
    } catch (error) {
      res.status(500).send(error);
    }
  });

  // update a restaurant
  app.put('/api/restaurants/:id', async (req, res) => {
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
  app.delete('/api/restaurants/:id', async (req, res) => {
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

  app.listen(PORT, () => {
    console.error(`Node ${isDev ? 'dev server' : 'cluster worker '+process.pid}: listening on port ${PORT}`);
  });
}
