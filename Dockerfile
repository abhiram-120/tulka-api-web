FROM node:20-alpine
WORKDIR /tulkka-backend
COPY package.json .
RUN npm install
COPY . .
EXPOSE 6060
CMD [ "npm","run","dev" ]