# Use official Node.js image
FROM apify/actor-node:18

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --quiet && npm cache clean --force

# Copy the rest of the code
COPY . ./

# Run the actor
CMD ["npm", "start"]
