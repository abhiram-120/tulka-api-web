FROM node:20-alpine
WORKDIR /tulkka-backend
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
EXPOSE 8000
CMD [ "npm","start" ]